const withFontScaleConfig = require("../withFontScaleConfig");

function manifest(configChanges?: string) {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android", package: "com.relodojo.app" },
      "uses-permission": [{ $: { "android:name": "android.permission.INTERNET" } }],
      application: [{
        $: { "android:name": ".MainApplication", "android:usesCleartextTraffic": "false" },
        activity: [
          { $: { "android:name": ".OtherActivity", "android:configChanges": "orientation" } },
          { $: {
            "android:name": ".MainActivity", "android:launchMode": "singleTask", "android:windowSoftInputMode": "adjustResize",
            ...(configChanges === undefined ? {} : { "android:configChanges": configChanges }),
          } },
        ],
      }],
    },
  };
}
async function apply(input: ReturnType<typeof manifest>, count = 1) {
  let config: any = { name: "Relo Dojo", slug: "relo-dojo" };
  for (let i = 0; i < count; i++) config = withFontScaleConfig(config);
  const result = await config.mods.android.manifest({
    ...config, modResults: input,
    modRequest: { projectRoot: "/fixture", platformProjectRoot: "/fixture/android", platform: "android", modName: "manifest" },
  });
  return result.modResults as ReturnType<typeof manifest>;
}
const main = (input: ReturnType<typeof manifest>) => input.manifest.application[0].activity[1].$;

it("adds fontScale without changing existing lifecycle flags, other activities or unrelated native configuration", async () => {
  const flags = "keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode";
  const input = manifest(flags); const before = JSON.parse(JSON.stringify(input));
  const result = await apply(input);
  expect(main(result)["android:configChanges"]).toBe(`${flags}|fontScale`);
  main(before)["android:configChanges"] = `${flags}|fontScale`;
  expect(result).toEqual(before);
});

it("is idempotent when composed twice and on a subsequent prebuild", async () => {
  const flags = "fontScale|orientation|screenSize";
  const input = manifest(flags);
  const result = await apply(input, 2);
  expect(main(result)["android:configChanges"]).toBe(flags);
  const next = await apply(result);
  expect(main(next)["android:configChanges"]).toBe(flags);
  expect(main(next)["android:configChanges"]!.split("|").filter((flag) => flag === "fontScale")).toHaveLength(1);
});

it("handles a missing configChanges attribute without introducing unrelated flags", async () => {
  const result = await apply(manifest());
  expect(main(result)["android:configChanges"]).toBe("fontScale");
});

it("fails the build rather than modifying another activity when MainActivity is absent", async () => {
  const input = manifest("orientation"); input.manifest.application[0].activity.splice(1, 1);
  await expect(apply(input)).rejects.toThrow("missing the required MainActivity");
  expect(input.manifest.application[0].activity[0].$["android:configChanges"]).toBe("orientation");
});

const kotlin = `package com.relodojo.app

import android.os.Bundle
import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(null)
  }
  override fun getMainComponentName(): String = "main"
  override fun invokeDefaultOnBackPressed() {
    super.invokeDefaultOnBackPressed()
  }
}

class OtherActivity {
  fun keepMe() = "untouched"
}
`;
async function applyActivity(contents: string, language = "kt", count = 1) {
  let config: any = { name: "Relo Dojo", slug: "relo-dojo" };
  for (let i = 0; i < count; i++) config = withFontScaleConfig(config);
  const result = await config.mods.android.mainActivity({
    ...config, modResults: { path: "/fixture/android/MainActivity.kt", language, contents },
    modRequest: { projectRoot: "/fixture", platformProjectRoot: "/fixture/android", platform: "android", modName: "mainActivity" },
  });
  return result.modResults.contents as string;
}

it("adds a module-only font metrics refresh while preserving all existing lifecycle and class code", async () => {
  const result = await applyActivity(kotlin);
  const adapter = result.match(/\n  \/\/ @generated begin relo-font-scale-config[\s\S]*?  \/\/ @generated end relo-font-scale-config/)![0];
  expect(result.replace(adapter, "")).toBe(kotlin);
  expect(adapter).toContain("super.onConfigurationChanged(newConfig)");
  expect(adapter).toContain('context.getNativeModule("DeviceInfo") as? com.facebook.react.bridge.LifecycleEventListener');
  expect(adapter).toContain("com.facebook.react.uimanager.DisplayMetricsHolder.initDisplayMetrics(context)");
  expect(adapter).toContain("metrics?.onHostResume()");
  expect(adapter).toContain("val root = reactDelegate?.reactRootView");
  expect(adapter).toContain("root.forceLayout()");
  expect(adapter).toContain("makeMeasureSpec(root.width, android.view.View.MeasureSpec.EXACTLY)");
  expect(adapter).toContain("makeMeasureSpec(root.height, android.view.View.MeasureSpec.EXACTLY)");
  expect(adapter.indexOf("initDisplayMetrics(context)")).toBeLessThan(adapter.indexOf("root.measure("));
  expect(adapter.indexOf("root.measure(")).toBeLessThan(adapter.indexOf("root.requestLayout()"));
  expect(adapter.indexOf("root.requestLayout()")).toBeLessThan(adapter.indexOf("metrics?.onHostResume()"));
  expect(adapter.indexOf("initDisplayMetrics(context)")).toBeLessThan(adapter.indexOf("metrics?.onHostResume()"));
  expect(adapter.indexOf("super.onConfigurationChanged")).toBeLessThan(adapter.indexOf('getNativeModule("DeviceInfo")'));
  expect(adapter).not.toMatch(/(?:reactHost|context)\??\.onHostResume\(/);
  expect(adapter).not.toContain("recreate()");
});

it("keeps the Kotlin adapter byte-identical across duplicate composition and another prebuild", async () => {
  const once = await applyActivity(kotlin);
  expect(await applyActivity(kotlin, "kt", 2)).toBe(once);
  expect(await applyActivity(once)).toBe(once);
  expect((once.match(/override fun onConfigurationChanged/g) ?? [])).toHaveLength(1);
});

it.each([
  ["java", "public class MainActivity extends ReactActivity {}"],
  ["kt", kotlin.replace("class MainActivity : ReactActivity()", "class MainActivity : CustomActivity()")],
])("rejects unsupported %s activity source instead of rewriting its lifecycle", async (language, contents) => {
  await expect(applyActivity(contents, language)).rejects.toThrow("Kotlin MainActivity template");
});

it("rejects a custom configuration override and an altered managed block", async () => {
  const custom = kotlin.replace("  override fun onCreate", "  override fun onConfigurationChanged(config: android.content.res.Configuration) {}\n  override fun onCreate");
  await expect(applyActivity(custom)).rejects.toThrow("custom onConfigurationChanged");
  const managed = await applyActivity(kotlin);
  await expect(applyActivity(managed.replace("metrics?.onHostResume()", "customMetricsRefresh()"))).rejects.toThrow("unfamiliar managed adapter");
});


const application = `package com.relodojo.app
import android.app.Application
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = ReleaseLevel.STABLE
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
`;
async function applyApplication(contents: string, language = "kt", count = 1) {
  let config: any = { name: "Relo Dojo", slug: "relo-dojo" };
  for (let i = 0; i < count; i++) config = withFontScaleConfig(config);
  const result = await config.mods.android.mainApplication({
    ...config, modResults: { path: "/fixture/android/MainApplication.kt", language, contents },
    modRequest: { projectRoot: "/fixture", platformProjectRoot: "/fixture/android", platform: "android", modName: "mainApplication" },
  });
  return result.modResults.contents as string;
}

it("preserves application startup/lifecycle while delegating every flag except font scale to the exact stable provider", async () => {
  const result = await applyApplication(application);
  const bootstrap = result.match(/\n  \/\/ @generated begin relo-font-scale-bootstrap[\s\S]*?  \/\/ @generated end relo-font-scale-bootstrap/)![0];
  expect(result.replace(bootstrap, "").replace("    loadReactNativeWithFontScale()", "    loadReactNative(this)")).toBe(application);
  expect(bootstrap).toContain('check(BuildConfig.IS_NEW_ARCHITECTURE_ENABLED)');
  expect(bootstrap).toContain('ReleaseLevel.STABLE');
  expect(bootstrap).toContain('ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android(true, true, true)');
  expect(bootstrap).toContain('ReactNativeFeatureFlagsProvider by stable');
  expect(bootstrap.match(/override fun /g)).toHaveLength(1);
  expect(bootstrap).toContain('override fun enableFontScaleChangesUpdatingLayout(): Boolean = true');
  expect(bootstrap).toContain('@Suppress("INVISIBLE_MEMBER", "INVISIBLE_REFERENCE")');
  expect(bootstrap).toContain('catch (error: java.io.IOException)');
  expect(bootstrap).toContain('throw RuntimeException(error)');
  expect(bootstrap).toContain('if (BuildConfig.IS_EDGE_TO_EDGE_ENABLED)');
  expect(bootstrap.indexOf('SoLoader.init(')).toBeLessThan(bootstrap.indexOf('loadWithFeatureFlags(flags)'));
  expect(bootstrap.indexOf('loadWithFeatureFlags(flags)')).toBeLessThan(bootstrap.indexOf('setEdgeToEdgeFeatureFlagOn()'));
  expect(bootstrap).not.toMatch(/dangerously|CANARY|EXPERIMENTAL|FeatureFlags\.override/);
});

it("keeps the bootstrap byte-identical through repeated plugin composition and prebuild", async () => {
  const once = await applyApplication(application);
  expect(await applyApplication(application, "kt", 2)).toBe(once);
  expect(await applyApplication(once)).toBe(once);
});

it("rejects Java, custom loader calls and changed managed bootstraps", async () => {
  await expect(applyApplication(application, "java")).rejects.toThrow("Kotlin MainApplication template");
  await expect(applyApplication(application.replace("loadReactNative(this)", "customLoader(this)"))).rejects.toThrow("unmodified Expo SDK 54 Kotlin bootstrap call");
  const managed = await applyApplication(application);
  await expect(applyApplication(managed.replace("Boolean = true", "Boolean = false"))).rejects.toThrow("unfamiliar managed bootstrap");
});

it("rejects a modified native entry-point source before registering any mods", () => {
  const fs = require("node:fs");
  const original = fs.readFileSync;
  const spy = jest.spyOn(fs, "readFileSync").mockImplementation((...args: any[]) =>
    String(args[0]).endsWith("/DefaultNewArchitectureEntryPoint.kt") ? Buffer.from("modified") : original(...args));
  try {
    jest.isolateModules(() => {
      const guardedPlugin = require("../withFontScaleConfig");
      expect(() => guardedPlugin({ name: "Relo Dojo", slug: "relo-dojo" })).toThrow("modified ReactAndroid/src/main/java/com/facebook/react/defaults/DefaultNewArchitectureEntryPoint.kt");
    });
  } finally { spy.mockRestore(); }
});
