// js/oscilloscope.js
// Time-domain waveform display with auto-trigger and adjustable time scale.

export class Oscilloscope {
    constructor(canvas, analyser, sampleRate) {
        this.canvas = canvas;
        this.ctx2d = canvas.getContext('2d', { alpha: false });
        this.analyser = analyser;
        this.sampleRate = sampleRate;

        // Settings
        this.timeScale = 5; // ms
        this.frozen = false;

        // Render
        this.animFrameId = null;
        this.isRunning = false;
        this.lastFrameTime = 0;
        this.frameBudgetMs = 1000 / 30;

        // Layout
        this.pad = { top: 10, right: 10, bottom: 20, left: 40 };

        // Resize
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(this.canvas.parentElement);
        this._resize();
    }

    _resize() {
        const parent = this.canvas.parentElement;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = parent.clientWidth;
        const h = parent.clientHeight || 200;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.displayWidth = w;
        this.displayHeight = h;
        this.plotW = w - this.pad.left - this.pad.right;
        this.plotH = h - this.pad.top - this.pad.bottom;
    }

    setTimeScale(ms) {
        this.timeScale = ms;
    }

    toggleFreeze() {
        this.frozen = !this.frozen;
        return this.frozen;
    }

    exportPNG() {
        const link = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        link.download = `oscilloscope_${ts}.png`;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.dataArray = new Float32Array(this.analyser.fftSize);
        this.lastFrameTime = 0;
        this._loop(0);
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        this.ctx2d.fillStyle = '#000';
        this.ctx2d.fillRect(0, 0, this.displayWidth, this.displayHeight);
    }

    updateAnalyser(analyser, sampleRate) {
        this.analyser = analyser;
        this.sampleRate = sampleRate;
        this.dataArray = new Float32Array(analyser.fftSize);
    }

    destroy() {
        this.stop();
        if (this._resizeObserver) this._resizeObserver.disconnect();
    }

    _loop(timestamp) {
        if (!this.isRunning) return;
        this.animFrameId = requestAnimationFrame((t) => this._loop(t));
        const elapsed = timestamp - this.lastFrameTime;
        if (elapsed < this.frameBudgetMs) return;
        this.lastFrameTime = timestamp;
        if (!this.frozen) this._draw();
    }

    _draw() {
        const ctx = this.ctx2d;
        const W = this.displayWidth;
        const H = this.displayHeight;
        const pad = this.pad;
        const plotW = this.plotW;
        const plotH = this.plotH;

        this.analyser.getFloatTimeDomainData(this.dataArray);

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        ctx.translate(pad.left, pad.top);

        // Calculate samples to display based on time scale
        const samplesToShow = Math.floor((this.timeScale / 1000) * this.sampleRate);
        const maxSamples = Math.min(samplesToShow, this.dataArray.length);

        // Auto-trigger: find rising zero-crossing
        let triggerOffset = 0;
        for (let i = 1; i < this.dataArray.length - maxSamples; i++) {
            if (this.dataArray[i - 1] <= 0 && this.dataArray[i] > 0) {
                triggerOffset = i;
                break;
            }
        }

        // Grid
        this._drawGrid(ctx, plotW, plotH);

        // Waveform
        ctx.beginPath();
        let first = true;
        for (let i = 0; i < maxSamples; i++) {
            const x = (i / maxSamples) * plotW;
            const sample = this.dataArray[triggerOffset + i] || 0;
            const y = plotH / 2 - (sample * plotH / 2);

            if (first) { ctx.moveTo(x, y); first = false; }
            else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = 'rgba(0, 255, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(0, 255, 255, 0.6)';
        ctx.shadowBlur = 5;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Border
        ctx.strokeStyle = 'rgba(0,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, plotW, plotH);

        ctx.restore();

        // Time scale label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '9px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${this.timeScale} ms`, W / 2, H - 12);
    }

    _drawGrid(ctx, plotW, plotH) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.font = '9px Consolas, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        // Amplitude grid: ±0.25, ±0.5, ±0.75, ±1.0
        const levels = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
        for (const val of levels) {
            const y = plotH / 2 - (val * plotH / 2);

            if (val === 0) {
                ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            } else {
                ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            }
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();

            if (val === 0 || Math.abs(val) === 0.5 || Math.abs(val) === 1) {
                ctx.fillText(val.toFixed(1), -4, y);
            }
        }

        // Time grid: vertical divisions
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        for (let i = 1; i < 10; i++) {
            const x = (i / 10) * plotW;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotH); ctx.stroke();
        }
    }
}
