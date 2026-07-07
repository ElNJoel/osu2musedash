interface Props {
  title?: string | null;
  artist?: string | null;
}

type MascotMood = {
  mood: string;
  face: string;
  accentClass: string;
  accessory: string;
  bubble: string;
};

function analyzeSongTitle(title?: string | null, artist?: string | null): MascotMood {
  const raw = `${title ?? ""} ${artist ?? ""}`.trim();
  const t = raw.toLowerCase();

  if (!raw) {
    return {
      mood: "idle",
      face: "•ᴗ•",
      accentClass: "mint",
      accessory: "star",
      bubble: "Upload a beatmap and I will react to the song title for you."
    };
  }

  const rules: Array<{ match: RegExp; mood: MascotMood }> = [
    {
      match: /(night|moon|dark|shadow|midnight|black|resolve|phantom|joker)/i,
      mood: {
        mood: "mysterious",
        face: "◕‿◕",
        accentClass: "violet",
        accessory: "moon",
        bubble: `This title feels mysterious and stylish. I would preview it with a dreamy night vibe ✨`
      }
    },
    {
      match: /(love|heart|kiss|sweet|dream|smile|happy|sunshine|star)/i,
      mood: {
        mood: "cute",
        face: "˶ᵔ ᵕ ᵔ˶",
        accentClass: "pink",
        accessory: "heart",
        bubble: `Aww, this title feels extra kawaii. I would pair it with a cheerful pastel mood ♡`
      }
    },
    {
      match: /(fire|burn|inferno|rage|blood|kill|war|battle|danger)/i,
      mood: {
        mood: "intense",
        face: "òᴗó",
        accentClass: "orange",
        accessory: "flame",
        bubble: `This one sounds intense. I would guide the preview with a fiery action mood 🔥`
      }
    },
    {
      match: /(blue|rain|ocean|sky|wind|snow|ice|winter|sea)/i,
      mood: {
        mood: "calm",
        face: "ˆᵕˆ",
        accentClass: "cyan",
        accessory: "drop",
        bubble: `This title feels calm and cool. I would keep the companion soft and floaty 🌊`
      }
    },
    {
      match: /(run|speed|rush|go|chase|beat|dance|party|jump|up)/i,
      mood: {
        mood: "energetic",
        face: "≧◡≦",
        accentClass: "lime",
        accessory: "bolt",
        bubble: `Ooh, this sounds energetic. I would bounce along with a fast playful mood ⚡`
      }
    }
  ];

  for (const rule of rules) {
    if (rule.match.test(t)) return rule.mood;
  }

  return {
    mood: "neutral",
    face: "•ᴗ•",
    accentClass: "mint",
    accessory: "star",
    bubble: `I am reading “${title ?? raw}”. It feels balanced, so I would keep a cute all-purpose companion mood ✨`
  };
}

function accessoryGlyph(kind: string): string {
  switch (kind) {
    case "moon": return "☾";
    case "heart": return "❤";
    case "flame": return "✦";
    case "drop": return "✿";
    case "bolt": return "⚡";
    default: return "★";
  }
}

export function SongMascot({ title, artist }: Props) {
  const mood = analyzeSongTitle(title, artist);

  return (
    <aside className={`mascotDock ${mood.accentClass}`}>
      <div className="mascotBubble">
        <p className="mascotCaption">Kawaii helper</p>
        <strong>{title ? `Detected song: ${title}` : "Waiting for song title"}</strong>
        {artist && <p className="mascotMeta">Artist: {artist}</p>}
        <p>{mood.bubble}</p>
      </div>

      <div className="mascotStage">
        <div className="mascotShadow" />
        <div className="mascotAccessory">{accessoryGlyph(mood.accessory)}</div>
        <div className="mascot3D">
          <div className="mascotHead">
            <div className="mascotEar left" />
            <div className="mascotEar right" />
            <div className="mascotFace">
              <span>{mood.face}</span>
            </div>
          </div>
          <div className="mascotBody">
            <div className="mascotBelly" />
          </div>
          <div className="mascotArm left" />
          <div className="mascotArm right" />
          <div className="mascotLeg left" />
          <div className="mascotLeg right" />
        </div>
      </div>
    </aside>
  );
}
