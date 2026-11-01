import { View } from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";
import { useTheme } from "../../theme/theme";

/** Fixed room, three authored objects. Equipment changes the drawing, never the room's layout. */
export default function DojoScene({ equipped = {}, compact = false, accessibilityLabel }: {
  equipped?: Record<string, string>; compact?: boolean; accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const light = equipped.dojo_light ?? "dojo_light_paper";
  const display = equipped.dojo_display ?? "dojo_display_blank";
  const plant = equipped.dojo_plant ?? "dojo_plant_seedling";
  const lantern = light === "dojo_light_lantern";
  const sunset = light === "dojo_light_sunset";
  const bamboo = plant === "dojo_plant_bamboo";
  return (
    <View accessible={!!accessibilityLabel} accessibilityRole="image" accessibilityLabel={accessibilityLabel}
      testID="dojo-scene" style={{ width: "100%", aspectRatio: compact ? 2.2 : 1.36, overflow: "hidden", borderRadius: 16, backgroundColor: c.surface2 }}>
      <Svg width="100%" height="100%" viewBox={compact ? "0 22 360 164" : "0 0 360 265"} preserveAspectRatio="xMidYMid slice">
        <Rect width="360" height="265" fill={c.surface2} />
        <Rect x="23" y="32" width="314" height="157" fill={c.surface} />
        <Rect x="23" y="31" width="314" height="10" fill={c.ink2} />
        <Rect x="20" y="35" width="10" height="158" rx="2" fill={c.ink2} />
        <Rect x="330" y="35" width="10" height="158" rx="2" fill={c.ink2} />
        <Rect x="30" y="178" width="300" height="9" fill={c.ink2} />
        <Path d="M0 210L30 187H330L360 210V265H0Z" fill={c.accentSoft} />
        <Path d="M0 229H360M0 260H360M80 187L59 265M181 187V265M280 187L300 265" stroke={c.line2} strokeWidth="1.5" />
        <Path d="M0 210H360" stroke={c.ink2} strokeWidth="3" />
        <Rect x="42" y="53" width="79" height="113" rx="2" fill={c.accentSoft} stroke={c.line2} strokeWidth="2" />
        <Circle cx="82" cy="87" r="22" fill={c.surface} />
        <Path d="M43 139L68 116L84 132L103 109L120 135V165H43Z" fill={c.accentSoft2} />
        <G stroke={c.line2} strokeWidth="2">
          <Line x1="68" y1="54" x2="68" y2="164" /><Line x1="94" y1="54" x2="94" y2="164" />
          <Line x1="43" y1="91" x2="120" y2="91" /><Line x1="43" y1="128" x2="120" y2="128" />
        </G>
        <Rect x="139" y="54" width="83" height="121" fill={c.surface2} />
        <Rect x="143" y="171" width="75" height="5" rx="1" fill={c.ink2} />
        <G testID={`dojo-object-${display}`}>
          <Path d="M159 61H202L199 141H162Z" fill={c.surface} stroke={c.line2} strokeWidth="1.5" />
          <Rect x="155" y="59" width="51" height="4" rx="2" fill={c.ink2} />
          <Rect x="158" y="140" width="45" height="4" rx="2" fill={c.ink2} />
          <Path d="M181 144V153" stroke={c.ink2} strokeWidth="1.5" />
          {display === "dojo_display_first_scroll" && <G stroke={c.accent} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="181" cy="91" r="12" /><Path d="M172 115H191M176 123H187M175 92L179 96L187 86" />
          </G>}
          {display === "dojo_display_wave" && <G fill="none" stroke={c.accent} strokeWidth="2.5" strokeLinecap="round">
            <Path d="M166 116C170 105 179 119 186 99C189 90 197 94 196 101C191 96 187 110 198 114M165 123C174 115 185 129 198 120M166 130C176 123 187 134 196 128" />
            <Circle cx="173" cy="82" r="6" fill={c.gold} stroke="none" />
          </G>}
        </G>
        <G testID={`dojo-object-${light}`}>
          <Path d="M277 40V65" stroke={c.ink2} strokeWidth="2" />
          {lantern ? <>
            <Rect x="255" y="68" width="44" height="49" rx="14" fill={c.fireSoft} stroke={c.gold} strokeWidth="2" />
            <Path d="M258 79H296M256 91H298M258 104H296M267 70V115M287 70V115" stroke={c.gold} strokeWidth="1.5" />
            <Path d="M269 65H285M268 119H286M277 120V130M272 130H282" stroke={c.ink2} strokeWidth="3" strokeLinecap="round" />
          </> : sunset ? <>
            <Path d="M249 85L258 67H296L305 85V106H249Z" fill={c.fireSoft} stroke={c.fire} strokeWidth="2" />
            <Path d="M249 94H305M261 69L256 105M293 69L299 105" stroke={c.fire} strokeWidth="1.5" />
            <Path d="M273 108H281M277 110V118" stroke={c.ink2} strokeWidth="2" strokeLinecap="round" />
          </> : <>
            <Path d="M258 68H296L302 103H252Z" fill={c.surface2} stroke={c.line2} strokeWidth="2" />
            <Path d="M262 78H292M260 88H295M271 68L269 102M283 68L285 102" stroke={c.line2} strokeWidth="1.5" />
            <Path d="M270 105H284" stroke={c.ink2} strokeWidth="2" />
          </>}
        </G>
        <G testID={`dojo-object-${plant}`}>
          <Ellipse cx="276" cy="181" rx="26" ry="4" fill={c.line} />
          <Path d="M260 157H291L285 179H266Z" fill={c.fireSoft} stroke={c.fire} strokeWidth="1.5" />
          <Rect x="257" y="155" width="37" height="6" rx="2" fill={c.fire} />
          {bamboo ? <G fill={c.accent} stroke={c.accent} strokeWidth="2" strokeLinecap="round">
            <Path d="M271 155V109M282 155V120" fill="none" strokeWidth="3" />
            <Path d="M270 134C258 134 255 123 255 123C267 123 270 134 270 134ZM272 122C272 112 286 109 286 109C284 119 272 122 272 122ZM281 143C285 131 298 132 298 132C295 143 281 143 281 143Z" />
            <Path d="M268 145H274M268 132H274M268 119H274M279 147H285M279 134H285" stroke={c.surface2} strokeWidth="1.5" />
          </G> : <G fill={c.accent} stroke={c.accent} strokeWidth="2" strokeLinecap="round">
            <Path d="M276 155V139" fill="none" />
            <Path d="M276 145C263 146 260 135 260 135C271 132 276 145 276 145ZM276 139C275 127 287 125 287 125C290 135 276 139 276 139Z" />
          </G>}
        </G>
        {!compact && <G>
          <Path d="M111 214L222 214L238 246H96Z" fill={c.surface} stroke={c.line2} strokeWidth="1.5" />
          <Path d="M113 222H220M109 233H227" stroke={c.line} strokeWidth="1" />
          <Ellipse cx="78" cy="233" rx="17" ry="4" fill={c.line2} />
          <Path d="M67 221H86V231C86 238 67 238 67 231Z" fill={c.surface} stroke={c.ink2} strokeWidth="1.5" />
          <Path d="M87 222C96 221 96 231 87 230M74 213C70 208 79 207 75 202" fill="none" stroke={c.ink2} strokeWidth="1.5" strokeLinecap="round" />
        </G>}
      </Svg>
    </View>
  );
}
