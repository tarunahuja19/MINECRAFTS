import React, { useEffect, useRef } from "react";
import { Radio } from "lucide-react";

interface SeismographOscilloscopeProps {
  vibrationActive: boolean;
  vibrationPPV: number;
}

export const SeismographOscilloscope: React.FC<SeismographOscilloscopeProps> = ({
  vibrationActive,
  vibrationPPV,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<number[]>(new Array(160).fill(0));
  const phaseRef = useRef<number>(0);
  const decayAmpRef = useRef<number>(0);

  useEffect(() => {
    if (vibrationActive || vibrationPPV > 0) {
      decayAmpRef.current = Math.max(vibrationPPV, 22.0);
    }
  }, [vibrationActive, vibrationPPV]);

  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      // Advance wave simulation
      phaseRef.current += 0.45;
      decayAmpRef.current *= 0.96; // exponential seismic damping

      // Noise floor (0.15 mm/s baseline microseismic tremor)
      const noise = (Math.random() - 0.5) * 0.4;
      const transient = decayAmpRef.current * Math.sin(phaseRef.current * 2.8) * Math.cos(phaseRef.current * 0.7);
      const currentSample = noise + transient;

      // Update buffer
      bufferRef.current.shift();
      bufferRef.current.push(currentSample);

      // Draw oscilloscope canvas
      ctx.fillStyle = "var(--bg-viewport)";
      ctx.fillRect(0, 0, width, height);

      // Grid lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.moveTo(0, centerY - height * 0.35);
      ctx.lineTo(width, centerY - height * 0.35);
      ctx.moveTo(0, centerY + height * 0.35);
      ctx.lineTo(width, centerY + height * 0.35);
      ctx.stroke();

      // DGMS Critical PPV Limit Line (15.0 mm/s)
      const limitY_upper = centerY - (15.0 / 30.0) * (height * 0.45);
      const limitY_lower = centerY + (15.0 / 30.0) * (height * 0.45);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, limitY_upper);
      ctx.lineTo(width, limitY_upper);
      ctx.moveTo(0, limitY_lower);
      ctx.lineTo(width, limitY_lower);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Seismic PPV Waveform Trace
      const isAlarm = Math.abs(currentSample) > 15.0 || decayAmpRef.current > 15.0;
      ctx.strokeStyle = isAlarm ? "var(--state-critical)" : decayAmpRef.current > 4.0 ? "var(--state-info)" : "var(--state-active)";
      ctx.lineWidth = isAlarm ? 2.0 : 1.5;
      ctx.beginPath();

      const dx = width / (bufferRef.current.length - 1);
      for (let i = 0; i < bufferRef.current.length; i++) {
        const val = bufferRef.current[i];
        const y = centerY - (val / 30.0) * (height * 0.45);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * dx, y);
      }
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  const currentPPV = decayAmpRef.current > 0.2 ? decayAmpRef.current : 0.18;

  return (
    <div className="hud-card" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Radio size={13} color={currentPPV > 15.0 ? "var(--state-critical)" : "var(--state-info)"} />
          <span style={{ fontSize: "var(--fs-label)", fontWeight: 800, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
            REAL-TIME SEISMOGRAPH (PPV MONITOR)
          </span>
        </div>
        <div className="font-mono" style={{ fontSize: "var(--fs-body)", fontWeight: 800, color: currentPPV > 15 ? "var(--state-critical)" : "var(--state-active)" }}>
          PPV: {currentPPV.toFixed(2)} mm/s
        </div>
      </div>

      <div style={{ position: "relative", width: "100%", height: "80px", background: "var(--bg-viewport)", border: "1px solid rgba(255, 255, 255, 0.1)" }}>
        <canvas ref={canvasRef} width={400} height={80} style={{ width: "100%", height: "100%", display: "block" }} />
        <div style={{ position: "absolute", top: "2px", right: "4px", fontSize: "var(--fs-label)", color: "rgba(239, 68, 68, 0.7)", fontFamily: "var(--font-mono)" }}>
          DGMS PPV Limit: 15.0 mm/s
        </div>
      </div>

      <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}>
        <span>DGMS Circular 7 / 1997 Compliance</span>
        <span style={{ color: currentPPV > 15 ? "var(--state-critical)" : "var(--state-active)" }}>
          {currentPPV > 15 ? "⚠ BLAST TRANSIENT DETECTED" : "✓ BASELINE SEISMIC QUIET"}
        </span>
      </div>
    </div>
  );
};
