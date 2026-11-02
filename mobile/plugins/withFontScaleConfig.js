const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { AndroidConfig, withAndroidManifest, withMainActivity, withMainApplication } = require("expo/config-plugins");

// This small bootstrap adapter uses a version-internal RN entry point. Review it on upgrade;
// never replace the stable provider or apply another override after any flag was read.
function assertPinnedBootstrap() {
  const packages = { "react-native": "0.81.5", "@react-native/gradle-plugin": "0.81.5", "@expo/config-plugins": "54.0.6" };
  for (const [name, version] of Object.entries(packages)) {
    if (require(`${name}/package.json`).version !== version) {
      throw new Error(`withFontScaleConfig requires ${name} ${version}; review the native bootstrap before upgrading`);
    }
  }
  const sources = [
    ["react-native", "ReactAndroid/src/main/java/com/facebook/react/defaults/DefaultNewArchitectureEntryPoint.kt", "725096b5a095536f4c11ed6b885ed9409fac228d7f0eb2e1ebbbe3199e7d3e2f"],
    ["react-native", "ReactAndroid/src/main/java/com/facebook/react/internal/featureflags/ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android.kt", "8a138b65a53756c53fd5eeb6c83d494c1637ee589fe8d1d32a4f85b38800278c"],
    ["@react-native/gradle-plugin", "react-native-gradle-plugin/src/main/kotlin/com/facebook/react/tasks/GenerateEntryPointTask.kt", "1f7a744db66e31a374ed47c8348d90a2d9e69a6a4d61e4ea2a912419cc2d4195"],
  ];
  for (const [name, relative, expected] of sources) {
    const file = path.join(path.dirname(require.resolve(`${name}/package.json`)), relative);
    if (createHash("sha256").update(readFileSync(file)).digest("hex") !== expected) {
      throw new Error(`withFontScaleConfig found modified ${relative}; review the native bootstrap before prebuild`);
    }
  }
}

const BOOTSTRAP_START = "  // @generated begin relo-font-scale-bootstrap";
const BOOTSTRAP_END = "  // @generated end relo-font-scale-bootstrap";
const BOOTSTRAP = `${BOOTSTRAP_START}
  @Suppress("INVISIBLE_MEMBER", "INVISIBLE_REFERENCE")
  private fun loadReactNativeWithFontScale() {
    check(BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) { "Font-scale adapter requires the pinned New Architecture" }
    check(com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.releaseLevel == com.facebook.react.common.ReleaseLevel.STABLE) {
      "Font-scale adapter requires the pinned RN OSS stable provider"
    }
    // Preserve the generated RN 0.81.5 entry point's loader/error and edge-to-edge behavior.
    try {
      com.facebook.soloader.SoLoader.init(this, com.facebook.react.soloader.OpenSourceMergedSoMapping)
    } catch (error: java.io.IOException) {
      throw RuntimeException(error)
    }
    val stable = com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android(true, true, true)
    val flags = object : com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider by stable {
      override fun enableFontScaleChangesUpdatingLayout(): Boolean = true
    }
    com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.loadWithFeatureFlags(flags)
    if (BuildConfig.IS_EDGE_TO_EDGE_ENABLED) {
      com.facebook.react.views.view.setEdgeToEdgeFeatureFlagOn()
    }
  }
${BOOTSTRAP_END}`;

const START = "  // @generated begin relo-font-scale-config";
const END = "  // @generated end relo-font-scale-config";
const ADAPTER = `${START}
  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    super.onConfigurationChanged(newConfig)
    // Commit the real font scale to Fabric before notifying JS display-text leaves.
    // Keep the same activity, native root, inputs and actual current viewport.
    val context = reactHost?.currentReactContext ?: return
    com.facebook.react.uimanager.DisplayMetricsHolder.initDisplayMetrics(context)
    val root = reactDelegate?.reactRootView
    if (root != null && root.width > 0 && root.height > 0) {
      root.forceLayout()
      root.measure(
        android.view.View.MeasureSpec.makeMeasureSpec(root.width, android.view.View.MeasureSpec.EXACTLY),
        android.view.View.MeasureSpec.makeMeasureSpec(root.height, android.view.View.MeasureSpec.EXACTLY)
      )
      root.requestLayout()
    }
    val metrics = context.getNativeModule("DeviceInfo") as? com.facebook.react.bridge.LifecycleEventListener
    metrics?.onHostResume()
  }
${END}`;

// Keep the React activity alive when Android's font size changes. The pinned native flag
// updates Fabric font metrics; activity recreation would otherwise discard routes and drafts.
module.exports = function withFontScaleConfig(config) {
  assertPinnedBootstrap();
  config = withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    const current = activity.$["android:configChanges"] ?? "";
    if (!current.split("|").some((value) => value.trim() === "fontScale")) {
      activity.$["android:configChanges"] = current ? `${current}|fontScale` : "fontScale";
    }
    return mod;
  });
  config = withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("withFontScaleConfig requires the Expo SDK 54 Kotlin MainActivity template");
    }
    const source = mod.modResults.contents;
    const hasAdapter = source.includes(ADAPTER);
    if ((source.includes(START) || source.includes(END)) && !hasAdapter) {
      throw new Error("withFontScaleConfig found an unfamiliar managed adapter; reconcile it before prebuild");
    }
    const unmanaged = hasAdapter ? source.replace(ADAPTER, "") : source;
    if (/\bfun\s+onConfigurationChanged\s*\(/.test(unmanaged)) {
      throw new Error("withFontScaleConfig will not overwrite a custom onConfigurationChanged override");
    }
    const declaration = /^class MainActivity : ReactActivity\(\) \{/m;
    if (!declaration.test(unmanaged)) {
      throw new Error("withFontScaleConfig requires the Expo SDK 54 Kotlin MainActivity template");
    }
    if (!hasAdapter) {
      mod.modResults.contents = source.replace(declaration, (match) => `${match}\n${ADAPTER}`);
    }
    return mod;
  });
  return withMainApplication(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("withFontScaleConfig requires the Expo SDK 54 Kotlin MainApplication template");
    }
    const source = mod.modResults.contents;
    const hasBootstrap = source.includes(BOOTSTRAP);
    if ((source.includes(BOOTSTRAP_START) || source.includes(BOOTSTRAP_END)) && !hasBootstrap) {
      throw new Error("withFontScaleConfig found an unfamiliar managed bootstrap; reconcile it before prebuild");
    }
    const declaration = /^class MainApplication : Application\(\), ReactApplication \{/m;
    const originalCall = "    loadReactNative(this)";
    const customCall = "    loadReactNativeWithFontScale()";
    if (!declaration.test(source) || source.split(hasBootstrap ? customCall : originalCall).length !== 2
        || (hasBootstrap && source.includes(originalCall)) || (!hasBootstrap && source.includes(customCall))) {
      throw new Error("withFontScaleConfig requires the unmodified Expo SDK 54 Kotlin bootstrap call");
    }
    if (!hasBootstrap) {
      mod.modResults.contents = source.replace(originalCall, customCall)
        .replace(declaration, (match) => `${match}\n${BOOTSTRAP}`);
    }
    return mod;
  });
};
