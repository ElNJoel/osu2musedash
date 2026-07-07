import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  imageFile: File | null;
  onAccept: (blob: Blob) => void;
}

export function CoverCropper({ imageFile, onAccept }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [dragging, setDragging] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const imageUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);

  useEffect(() => {
    if (!imageUrl) {
      setImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = imageUrl;
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  useEffect(() => {
    draw(false);
  }, [image, scale, offsetX, offsetY]);

  function draw(finalCircle: boolean) {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.save();

    if (finalCircle) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
    }

    const baseScale = Math.max(size / image.width, size / image.height);
    const drawW = image.width * baseScale * scale;
    const drawH = image.height * baseScale * scale;
    const x = (size - drawW) / 2 + offsetX;
    const y = (size - drawH) / 2 + offsetY;
    ctx.drawImage(image, x, y, drawW, drawH);
    ctx.restore();

    if (!finalCircle) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();
    }
  }

  async function accept() {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    draw(true);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not export cover."))), "image/png")
    );
    draw(false);
    onAccept(blob);
  }

  if (!imageFile) {
    return <div className="emptyBox">Upload or choose a background image to crop the Muse Dash cover.</div>;
  }

  return (
    <div className="cropGrid">
      <div>
        <canvas
          ref={canvasRef}
          width={512}
          height={512}
          className="coverCanvas"
          onMouseDown={(e) => setDragging({ x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY })}
          onMouseMove={(e) => {
            if (!dragging) return;
            setOffsetX(dragging.ox + e.clientX - dragging.x);
            setOffsetY(dragging.oy + e.clientY - dragging.y);
          }}
          onMouseUp={() => setDragging(null)}
          onMouseLeave={() => setDragging(null)}
        />
      </div>

      <div className="panelSoft">
        <h3>Mandatory cover crop</h3>
        <p>Drag the image inside the circle. Adjust zoom, then accept the circular PNG cover.</p>

        <label>
          Zoom
          <input type="range" min="1" max="3" step="0.01" value={scale} onChange={(e) => setScale(Number(e.target.value))} />
        </label>

        <div className="buttonRow">
          <button onClick={() => { setScale(1); setOffsetX(0); setOffsetY(0); }} type="button">
            Reset
          </button>
          <button className="primary" onClick={accept} type="button" disabled={!image}>
            Accept cover
          </button>
        </div>
      </div>
    </div>
  );
}
