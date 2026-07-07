interface Props {
  title?: string | null;
}

type MascotProfile = {
  type: string;
  name: string;
  face: string;
  accentClass: string;
  accessory: string;
  bubble: string;
};

function analyzeSongTitle(title?: string | null): MascotProfile {
  const raw = `${title ?? ""}`.trim();
  const t = raw.toLowerCase();

  if (!raw) {
    return {
      type: "starbun",
      name: "Starbun",
      face: "•ᴗ•",
      accentClass: "mint",
      accessory: "★",
      bubble: "Upload a beatmap and I will appear as a tiny song mascot."
    };
  }

  const rules: Array<{ match: RegExp; profile: MascotProfile }> = [
    {
      match: /(night|moon|dark|shadow|midnight|black|resolve|phantom|joker|mystic)/i,
      profile: {
        type: "phantomcat",
        name: "Phantom Cat",
        face: "◕‿◕",
        accentClass: "violet",
        accessory: "☾",
        bubble: `“${title}” feels mysterious, so I became a tiny Phantom Cat.`
      }
    },
    {
      match: /(love|heart|kiss|sweet|dream|smile|happy|sunshine|cute|star)/i,
      profile: {
        type: "heartbunny",
        name: "Heart Bunny",
        face: "˶ᵔ ᵕ ᵔ˶",
        accentClass: "pink",
        accessory: "❤",
        bubble: `“${title}” sounds soft and sweet, so I turned into Heart Bunny.`
      }
    },
    {
      match: /(fire|burn|inferno|rage|blood|kill|war|battle|danger|blaze)/i,
      profile: {
        type: "emberfox",
        name: "Ember Fox",
        face: "òᴗó",
        accentClass: "orange",
        accessory: "✦",
        bubble: `“${title}” sounds intense, so I show up as Ember Fox.`
      }
    },
    {
      match: /(blue|rain|ocean|sky|wind|snow|ice|winter|sea|water)/i,
      profile: {
        type: "aquadrop",
        name: "Aqua Drop",
        face: "ˆᵕˆ",
        accentClass: "cyan",
        accessory: "✿",
        bubble: `“${title}” feels airy and cool, so I became Aqua Drop.`
      }
    },
    {
      match: /(run|speed|rush|go|chase|beat|dance|party|jump|up|drive)/i,
      profile: {
        type: "boltbirb",
        name: "Bolt Birb",
        face: "≧◡≦",
        accentClass: "lime",
        accessory: "⚡",
        bubble: `“${title}” feels energetic, so I turned into Bolt Birb.`
      }
    }
  ];

  for (const rule of rules) {
    if (rule.match.test(t)) return rule.profile;
  }

  return {
    type: "starbun",
    name: "Starbun",
    face: "•ᴗ•",
    accentClass: "mint",
    accessory: "★",
    bubble: `I read “${title}”, so I chose a cute neutral mascot: Starbun.`
  };
}

export function SongMascot({ title }: Props) {
  const mascot = analyzeSongTitle(title);

  return (
    <aside className={`songMascotOverlay ${mascot.accentClass} ${mascot.type}`} aria-label="song mascot preview">
      <div className="songMascotBubble">
        <span className="songMascotLabel">Song mascot</span>
        <strong>{mascot.name}</strong>
        <p>{mascot.bubble}</p>
      </div>

      <div className="songMascotFloat">
        <div className="songMascotShadow" />
        <div className="songMascotAccessory">{mascot.accessory}</div>
        <div className="songMascotModel">
          <div className="songMascotTail" />
          <div className="songMascotHead">
            <div className="songMascotEar left" />
            <div className="songMascotEar right" />
            <div className="songMascotFace"><span>{mascot.face}</span></div>
          </div>
          <div className="songMascotBody"><div className="songMascotBelly" /></div>
          <div className="songMascotArm left" />
          <div className="songMascotArm right" />
          <div className="songMascotLeg left" />
          <div className="songMascotLeg right" />
        </div>
      </div>
    </aside>
  );
}
