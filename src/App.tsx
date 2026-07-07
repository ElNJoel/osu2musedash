import { useEffect, useMemo, useState } from "react";
import { CoverCropper } from "./CoverCropper";
import { DemoEditor } from "./DemoEditor";
import { SongMascot } from "./SongMascot";
import { estimateAudioDuration } from "./audioTools";
import { buildMdmPackage, downloadBlob, safeFilename } from "./mdmBuilder";
import { bytesToFile, findBestAudioPath, findBestBackgroundPath, loadBeatmapPackage, resolvePackageFile } from "./osuParser";
import type { ConversionSettings, DemoSelection, LoadedBeatmapPackage, OsuBeatmap, SelectedDifficulty } from "./types";
import "./styles.css";

const SCENES = [
  ["scene_01", "Space Station"],
  ["scene_02", "Retrocity"],
  ["scene_03", "Castle"],
  ["scene_04", "Rainy Night"],
  ["scene_05", "Candyland"],
  ["scene_06", "Oriental"],
  ["scene_07", "Groove Coaster"],
  ["scene_08", "Touhou"],
  ["scene_09", "DJMAX"]
] as const;

const SPEEDS = [
  [1, "Slow"],
  [2, "Normal"],
  [3, "Fast"]
] as const;

type Step = 1 | 2 | 3 | 4 | 5;

function modeName(map: OsuBeatmap) {
  return map.mode === 1 ? "osu!taiko" : "osu!standard";
}

function mapDuration(map: OsuBeatmap) {
  return Math.max(0, (map.lastHitMs - map.firstHitMs) / 1000);
}

function defaultDemoStart(map: OsuBeatmap) {
  if (map.previewTimeMs >= 0) return map.previewTimeMs / 1000;
  if (map.firstHitMs > 0) return Math.max(0, map.firstHitMs / 1000 - 5);
  return 30;
}

function sceneName(code: string): string {
  return SCENES.find(([value]) => value === code)?.[1] ?? code;
}

function progressFromMessage(msg: string): number | null {
  if (msg.includes("Starting .mdm build")) return 4;
  if (msg.includes("Writing info.json")) return 10;
  if (msg.includes("Writing BMS charts")) return 18;
  if (msg.includes("Converting audio")) return 28;
  if (msg.includes("Loading ffmpeg.wasm")) return 34;
  if (msg.includes("Loading audio into ffmpeg.wasm")) return 40;
  if (msg.includes("Encoding full music.ogg")) return 50;
  if (msg.includes("Encoding demo.ogg")) return 72;
  if (msg.includes("Writing cover.png")) return 88;
  if (msg.includes("Packing .mdm")) return 95;
  const match = msg.match(/ffmpeg progress\s+(\d+)%/i);
  if (match) {
    const pct = Number(match[1]);
    return 50 + (pct / 100) * 38;
  }
  return null;
}

export default function App() {
  const [step, setStep] = useState<Step>(1);
  const [pkg, setPkg] = useState<LoadedBeatmapPackage | null>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const [selected, setSelected] = useState<SelectedDifficulty[]>([]);
  const [settings, setSettings] = useState<ConversionSettings>({
    scene: "scene_04",
    playerSpeed: 2,
    lanePolicy: "auto",
    sliderHoldMs: 240,
    addBossEvents: true
  });
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDurationS, setAudioDurationS] = useState(180);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [demo, setDemo] = useState<DemoSelection | null>(null);
  const [cover, setCover] = useState<Blob | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string>("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildStatus, setBuildStatus] = useState("Waiting for input.");

  const mainMap = selected[0]?.beatmap ?? pkg?.beatmaps[0] ?? null;

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  const defaultOutputName = useMemo(() => {
    if (!mainMap) return "converted.mdm";
    return `${safeFilename(`${mainMap.artist} - ${mainMap.title}`)}.mdm`;
  }, [mainMap]);

  async function chooseOsuFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setLog([`Loading ${file.name}...`]);
    try {
      const loaded = await loadBeatmapPackage(file);
      setPkg(loaded);
      setSourceFileName(file.name);
      setSelected([]);
      setDemo(null);
      setCover(null);
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
      setCoverPreviewUrl("");
      setStep(2);
      setBuildProgress(0);
      setBuildStatus("Beatmap loaded.");
      setLog((l) => [...l, `Found ${loaded.beatmaps.length} supported difficulties.`]);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleDifficulty(map: OsuBeatmap) {
    const exists = selected.find((s) => s.beatmap.id === map.id);
    if (exists) {
      const next = selected.filter((s) => s.beatmap.id !== map.id).map((s, i) => ({ ...s, mdSlot: (i + 1) as 1 | 2 | 3 }));
      setSelected(next);
      return;
    }
    if (selected.length >= 3) {
      alert("Muse Dash shows 3 visible difficulty buttons. Choose up to 3.");
      return;
    }
    setSelected([
      ...selected,
      {
        beatmap: map,
        mdSlot: (selected.length + 1) as 1 | 2 | 3,
        mdLevel: map.estimatedMdLevel,
        designer: map.creator || "osu2MD web"
      }
    ]);
  }

  function updateSelected(map: OsuBeatmap, patch: Partial<SelectedDifficulty>) {
    setSelected((prev) => prev.map((s) => (s.beatmap.id === map.id ? { ...s, ...patch } : s)));
  }

  async function prepareAssets() {
    if (!pkg || !mainMap) return;
    const audioPath = findBestAudioPath(pkg, mainMap);
    const bgPath = findBestBackgroundPath(pkg, mainMap);
    const audioBytes = resolvePackageFile(pkg, audioPath);
    const bgBytes = resolvePackageFile(pkg, bgPath);

    if (audioBytes && audioPath) {
      const ext = audioPath.split(".").pop()?.toLowerCase() || "mp3";
      const file = bytesToFile(audioBytes, audioPath.split("/").pop() || `audio.${ext}`, `audio/${ext}`);
      setAudioFile(file);
      setAudioDurationS(await estimateAudioDuration(file).catch(() => Math.max(120, mapDuration(mainMap) + 30)));
    }

    if (bgBytes && bgPath) {
      const ext = bgPath.split(".").pop()?.toLowerCase() || "jpg";
      setBackgroundFile(bytesToFile(bgBytes, bgPath.split("/").pop() || `cover.${ext}`, `image/${ext}`));
    }

    setStep(3);
  }

  async function chooseExternalAudio(file: File | null) {
    if (!file) return;
    setAudioFile(file);
    setAudioDurationS(await estimateAudioDuration(file).catch(() => Math.max(120, mainMap ? mapDuration(mainMap) + 30 : 180)));
  }

  function chooseExternalImage(file: File | null) {
    if (file) setBackgroundFile(file);
  }

  async function acceptCover(blob: Blob) {
    setCover(blob);
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverPreviewUrl(URL.createObjectURL(blob));
    setStep(5);
  }

  async function generate() {
    if (!selected.length || !audioFile || !demo || !cover) {
      alert("You must select difficulties, accept demo trim, and accept cover crop first.");
      return;
    }

    setBusy(true);
    setBuildProgress(4);
    setBuildStatus("Starting .mdm build...");
    setLog(["Starting .mdm build..."]);

    try {
      const blob = await buildMdmPackage({
        selected,
        settings,
        audioFile,
        coverPng: cover,
        demo,
        onProgress: (msg) => {
          setLog((l) => [...l.slice(-10), msg]);
          setBuildStatus(msg);
          const next = progressFromMessage(msg);
          if (next !== null) setBuildProgress((prev) => Math.max(prev, Math.min(99, next)));
        }
      });
      setBuildProgress(100);
      setBuildStatus(`Done: ${defaultOutputName}`);
      downloadBlob(blob, defaultOutputName);
      setLog((l) => [...l, `Done: ${defaultOutputName}`]);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : String(err));
      const msg = err instanceof Error ? err.message : String(err);
      setLog((l) => [...l, `ERROR: ${msg}`]);
      setBuildStatus(`ERROR: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="hero heroSimple">
        <h1>osu! / osu!taiko → Muse Dash .mdm</h1>
      </header>

      <nav className="steps">
        {["Upload", "Difficulties", "Demo", "Cover", "Generate"].map((name, index) => (
          <button
            key={name}
            className={step === index + 1 ? "active" : ""}
            type="button"
            onClick={() => setStep((index + 1) as Step)}
            disabled={(index + 1) > step}
          >
            {index + 1}. {name}
          </button>
        ))}
      </nav>

      {step === 1 && (
        <section className="card">
          <h2>1. Upload beatmap</h2>
          <p>Choose an <code>.osz</code> package. Standalone <code>.osu</code> also works, but you will need to provide audio/image manually.</p>
          <label className="drop">
            <input type="file" accept=".osz,.osu" onChange={(e) => chooseOsuFile(e.target.files?.[0] ?? null)} />
            <span>Select .osz or .osu</span>
          </label>
          {sourceFileName && <p className="muted">Loaded: {sourceFileName}</p>}
        </section>
      )}

      {step === 2 && pkg && (
        <section className="card">
          <h2>2. Choose Muse Dash difficulties</h2>
          <p>Muse Dash normally shows 3 visible difficulty slots, so this web version exports <code>map1.bms</code>, <code>map2.bms</code>, and <code>map3.bms</code>. Pick up to 3.</p>
          <p className="selectionCount">Selected: {selected.length} / 3</p>

          <div className="diffList">
            {pkg.beatmaps.map((map) => {
              const picked = selected.find((s) => s.beatmap.id === map.id);
              return (
                <article className={picked ? "diff picked" : "diff"} key={map.id}>
                  <div>
                    <div className="diffTitleRow"><strong>{map.version}</strong>{picked && <span className="slotBadge">map{picked.mdSlot}</span>}</div>
                    <span>{modeName(map)} · {map.hitObjects.length} objects · {mapDuration(map).toFixed(1)}s · BPM {map.baseBpm.toFixed(2)}</span>
                    <span>OD {map.difficulty.OverallDifficulty ?? "?"} / CS {map.difficulty.CircleSize ?? "?"} / AR {map.difficulty.ApproachRate ?? "?"} / suggested MD Lv {map.estimatedMdLevel}</span>
                  </div>
                  <button className={picked ? "selectToggle isSelected" : "selectToggle"} type="button" onClick={() => toggleDifficulty(map)}>{picked ? `Selected · map${picked.mdSlot}` : "Select"}</button>
                  {picked && (
                    <div className="inlineFields">
                      <label>
                        Slot
                        <input value={`map${picked.mdSlot}.bms`} disabled />
                      </label>
                      <label>
                        MD level
                        <input type="number" min="1" max="12" value={picked.mdLevel} onChange={(e) => updateSelected(map, { mdLevel: Number(e.target.value) })} />
                      </label>
                      <label>
                        Designer
                        <input value={picked.designer} onChange={(e) => updateSelected(map, { designer: e.target.value })} />
                      </label>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <h3>Global conversion settings</h3>
          <div className="settingsGrid settingsGridWide">
            <div className="panelSoft">
              <label>Scene</label>
              <div className="scenePicker">
                {SCENES.map(([code, name]) => (
                  <button key={code} type="button" className={settings.scene === code ? "sceneChip active" : "sceneChip"} onClick={() => setSettings({ ...settings, scene: code })}>
                    <span className="sceneCode">{code}</span>
                    <strong>{name}</strong>
                  </button>
                ))}
              </div>
            </div>

            <div className="panelSoft">
              <label>Player speed</label>
              <div className="speedPicker">
                {SPEEDS.map(([value, name]) => (
                  <button key={value} type="button" className={settings.playerSpeed === value ? "speedChip active" : "speedChip"} onClick={() => setSettings({ ...settings, playerSpeed: value })}>
                    {value} — {name}
                  </button>
                ))}
              </div>

              <label>
                osu!standard lane policy
                <select value={settings.lanePolicy} onChange={(e) => setSettings({ ...settings, lanePolicy: e.target.value as any })}>
                  <option value="auto">auto</option>
                  <option value="hitsound">hitsound / taiko-like</option>
                  <option value="xy">xy position</option>
                  <option value="alternate">alternate</option>
                </select>
              </label>

              <label>
                Slider hold threshold ms
                <input type="number" min="0" step="10" value={settings.sliderHoldMs} onChange={(e) => setSettings({ ...settings, sliderHoldMs: Number(e.target.value) })} />
              </label>

              <label className="check">
                <input type="checkbox" checked={settings.addBossEvents} onChange={(e) => setSettings({ ...settings, addBossEvents: e.target.checked })} />
                Add simple boss entrance/exit events
              </label>
            </div>
          </div>

          <div className="buttonRow">
            <button type="button" onClick={() => setStep(1)}>Back</button>
            <button className="primary" type="button" disabled={!selected.length} onClick={prepareAssets}>Continue</button>
          </div>
        </section>
      )}

      {step === 3 && mainMap && (
        <section className="card">
          <h2>3. Trim demo.ogg</h2>
          <p>This step is mandatory.</p>
          <div className="buttonRow">
            <label className="smallUpload">
              <input type="file" accept="audio/*,.mp3,.ogg,.wav,.flac" onChange={(e) => chooseExternalAudio(e.target.files?.[0] ?? null)} />
              Use different audio file
            </label>
          </div>
          <DemoEditor audioFile={audioFile} audioDurationS={audioDurationS} defaultStartS={defaultDemoStart(mainMap)} firstHitS={mainMap.firstHitMs / 1000} onAccept={(d) => { setDemo(d); setStep(4); }} />
          {demo && <p className="ok">Demo accepted: start {demo.startS.toFixed(3)}s, duration {demo.durationS.toFixed(3)}s.</p>}
        </section>
      )}

      {step === 4 && (
        <section className="card">
          <h2>4. Crop cover.png</h2>
          <p>This step is mandatory.</p>
          <label className="smallUpload">
            <input type="file" accept="image/*,.png,.jpg,.jpeg" onChange={(e) => chooseExternalImage(e.target.files?.[0] ?? null)} />
            Use different background image
          </label>
          <CoverCropper imageFile={backgroundFile} onAccept={acceptCover} />
          {coverPreviewUrl && (
            <div className="coverPreviewCard">
              <div>
                <h3>Accepted cover preview</h3>
                <p>This is the circular image that will be written as <code>cover.png</code>.</p>
              </div>
              <img src={coverPreviewUrl} alt="Accepted circular cover preview" className="coverMiniPreview" />
            </div>
          )}
        </section>
      )}

      {step === 5 && (
        <section className="card">
          <h2>5. Generate .mdm</h2>
          <div className="summary summaryGrid">
            <div>
              <p><strong>Output:</strong> {defaultOutputName}</p>
              <p><strong>Difficulties:</strong> {selected.map((s) => `map${s.mdSlot}: ${s.beatmap.version} Lv ${s.mdLevel}`).join(" / ")}</p>
              <p><strong>Audio:</strong> {audioFile?.name ?? "missing"}</p>
              <p><strong>Demo:</strong> {demo ? `${demo.startS.toFixed(2)}s → ${(demo.startS + demo.durationS).toFixed(2)}s` : "missing"}</p>
              <p><strong>Scene:</strong> {sceneName(settings.scene)}</p>
              <p><strong>Cover:</strong> {cover ? "accepted" : "missing"}</p>
            </div>
            {coverPreviewUrl && <img src={coverPreviewUrl} alt="Final cover preview" className="coverMiniPreview large" />}
          </div>

          {busy && (
            <div className="progressCard">
              <div className="progressHeader"><strong>Generating package</strong><span>{Math.round(buildProgress)}%</span></div>
              <div className="progressBar"><div className="progressBarFill" style={{ width: `${buildProgress}%` }} /></div>
              <p className="progressStatus">{buildStatus}</p>
            </div>
          )}

          <button className="generate" type="button" disabled={busy || !demo || !cover || !audioFile} onClick={generate}>
            {busy ? "Generating..." : "Download Muse Dash .mdm"}
          </button>
        </section>
      )}

      <section className="log">
        <h3>Status</h3>
        {log.length ? log.map((line, i) => <p key={`${line}-${i}`}>{line}</p>) : <p>{buildStatus}</p>}
      </section>

      <SongMascot title={mainMap?.title ?? null} />
    </main>
  );
}
