// js/spectrum-visualizer.js
export class SpectrumVisualizer {
    constructor(canvas, statsContainer, analyser, sampleRate) {
        this.canvas = canvas;
        this.ctx2d = canvas.getContext('2d');
        this.stats = statsContainer;
        this.analyser = analyser;
        this.sampleRate = sampleRate;

        // dB range (adjustable via zoom)
        this.dbMin = -120;
        this.dbMax = 0;

        // Peak hold state
        this.peakHold = null;
        this.peakDecayRate = 0.3; // dB per frame

        // Render state
        this.animFrameId = null;
        this.isRunning = false;

        // Frequency axis labels (standard octave bands)
        this.freqLabels = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

        // Stats DOM refs
        this.statLeq = this.stats.querySelector('.stat-leq');
        this.statLpeak = this.stats.querySelector('.stat-lpeak');
        this.statCrest = this.stats.querySelector('.stat-crest');

        // Resize observer for responsive canvas
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(this.canvas.parentElement);
        this._resize();
    }

    _resize() {
        const parent = this.canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const w = parent.clientWidth;
        const h = parent.clientHeight || 280;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.displayWidth = w;
        this.displayHeight = h;
    }

    setDbRange(min, max) {
        this.dbMin = Math.max(-150, Math.min(min, max - 10));
        this.dbMax = Math.min(0, Math.max(max, min + 10));
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        // Initialize data buffer
        this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
        if (!this.peakHold || this.peakHold.length !== this.dataArray.length) {
            this.peakHold = new Float32Array(this.dataArray.length).fill(-Infinity);
        }

        this._loop();
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        // Clear canvas to black
        this.ctx2d.fillStyle = '#000';
        this.ctx2d.fillRect(0, 0, this.displayWidth, this.displayHeight);
        // Zero out stats
        if (this.statLeq) this.statLeq.textContent = '---';
        if (this.statLpeak) this.statLpeak.textContent = '---';
        if (this.statCrest) this.statCrest.textContent = '---';
    }

    updateAnalyser(analyser, sampleRate) {
        this.analyser = analyser;
        this.sampleRate = sampleRate;
        this.dataArray = new Float32Array(analyser.frequencyBinCount);
        this.peakHold = new Float32Array(this.dataArray.length).fill(-Infinity);
    }

    _loop() {
        if (!this.isRunning) return;
        this.animFrameId = requestAnimationFrame(() => this._loop());
        this._draw();
    }

    _draw() {
        const ctx = this.ctx2d;
        const W = this.displayWidth;
        const H = this.displayHeight;
        const pad = { top: 10, right: 15, bottom: 30, left: 50 };
        const plotW = W - pad.left - pad.right;
        const plotH = H - pad.top - pad.bottom;

        // Get frequency data
        this.analyser.getFloatFrequencyData(this.dataArray);
        const binCount = this.dataArray.length;
        const nyquist = this.sampleRate / 2;

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        // --- Draw grid ---
        this._drawGrid(ctx, pad, plotW, plotH, nyquist);

        // --- Draw spectrum (filled gradient curve) ---
        this._drawSpectrum(ctx, pad, plotW, plotH, binCount, nyquist);

        // --- Draw peak hold ---
        this._drawPeakHold(ctx, pad, plotW, plotH, binCount, nyquist);

        // --- Compute and display stats ---
        this._computeStats();
    }

    _freqToX(freq, plotW, nyquist) {
        // Logarithmic mapping from 20Hz to nyquist
        const minLog = Math.log10(20);
        const maxLog = Math.log10(nyquist);
        const fLog = Math.log10(Math.max(20, freq));
        return ((fLog - minLog) / (maxLog - minLog)) * plotW;
    }

    _dbToY(db, plotH) {
        // Map dB value to Y pixel
        const clamped = Math.max(this.dbMin, Math.min(this.dbMax, db));
        return plotH * (1 - (clamped - this.dbMin) / (this.dbMax - this.dbMin));
    }

    _drawGrid(ctx, pad, plotW, plotH, nyquist) {
        ctx.save();
        ctx.translate(pad.left, pad.top);

        // dB grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.font = '10px Consolas, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const dbStep = this.dbMax - this.dbMin <= 60 ? 5 : 10;
        for (let db = this.dbMax; db >= this.dbMin; db -= dbStep) {
            const y = this._dbToY(db, plotH);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(plotW, y);
            ctx.stroke();
            ctx.fillText(`${db}`, -5, y);
        }

        // Frequency grid lines
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const freq of this.freqLabels) {
            if (freq > nyquist) continue;
            const x = this._freqToX(freq, plotW, nyquist);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, plotH);
            ctx.stroke();

            const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
            ctx.fillText(label, x, plotH + 5);
        }

        // Plot border
        ctx.strokeStyle = 'rgba(0,255,255,0.15)';
        ctx.strokeRect(0, 0, plotW, plotH);

        ctx.restore();
    }

    _drawSpectrum(ctx, pad, plotW, plotH, binCount, nyquist) {
        ctx.save();
        ctx.translate(pad.left, pad.top);

        // Create gradient fill
        const gradient = ctx.createLinearGradient(0, 0, 0, plotH);
        gradient.addColorStop(0, 'rgba(0, 255, 255, 0.9)');
        gradient.addColorStop(0.3, 'rgba(0, 200, 255, 0.5)');
        gradient.addColorStop(0.7, 'rgba(0, 100, 200, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 50, 100, 0.05)');

        ctx.beginPath();
        ctx.moveTo(0, plotH); // bottom-left

        let firstPoint = true;
        for (let i = 1; i < binCount; i++) {
            const freq = (i / binCount) * nyquist;
            if (freq < 20) continue;

            const x = this._freqToX(freq, plotW, nyquist);
            const y = this._dbToY(this.dataArray[i], plotH);

            if (firstPoint) {
                ctx.lineTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.lineTo(plotW, plotH); // bottom-right
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw the top edge as a bright line
        ctx.beginPath();
        firstPoint = true;
        for (let i = 1; i < binCount; i++) {
            const freq = (i / binCount) * nyquist;
            if (freq < 20) continue;

            const x = this._freqToX(freq, plotW, nyquist);
            const y = this._dbToY(this.dataArray[i], plotH);

            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(0, 255, 255, 0.6)';
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.restore();
    }

    _drawPeakHold(ctx, pad, plotW, plotH, binCount, nyquist) {
        ctx.save();
        ctx.translate(pad.left, pad.top);

        ctx.fillStyle = 'rgba(255, 255, 0, 0.7)';

        for (let i = 1; i < binCount; i++) {
            const freq = (i / binCount) * nyquist;
            if (freq < 20) continue;

            const val = this.dataArray[i];

            // Update peak hold
            if (val > this.peakHold[i]) {
                this.peakHold[i] = val;
            } else {
                this.peakHold[i] -= this.peakDecayRate;
            }

            // Only draw every Nth bin to avoid visual clutter
            const x = this._freqToX(freq, plotW, nyquist);
            const y = this._dbToY(this.peakHold[i], plotH);

            // Draw a tiny dot
            if (i % 3 === 0) {
                ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5);
            }
        }

        ctx.restore();
    }

    _computeStats() {
        const data = this.dataArray;
        let sumPower = 0;
        let peak = -Infinity;
        let validCount = 0;

        for (let i = 1; i < data.length; i++) {
            const db = data[i];
            if (!isFinite(db)) continue;
            // Convert dB to power for RMS averaging
            sumPower += Math.pow(10, db / 10);
            if (db > peak) peak = db;
            validCount++;
        }

        const leq = validCount > 0 ? 10 * Math.log10(sumPower / validCount) : -Infinity;
        const crest = peak - leq;

        if (this.statLeq) this.statLeq.textContent = isFinite(leq) ? leq.toFixed(1) : '---';
        if (this.statLpeak) this.statLpeak.textContent = isFinite(peak) ? peak.toFixed(1) : '---';
        if (this.statCrest) this.statCrest.textContent = isFinite(crest) ? crest.toFixed(1) : '---';
    }

    destroy() {
        this.stop();
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
    }
}
