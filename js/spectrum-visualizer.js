// js/spectrum-visualizer.js
export class SpectrumVisualizer {
    constructor(canvas, statsContainer, analyser, sampleRate) {
        this.canvas = canvas;
        this.ctx2d = canvas.getContext('2d', { alpha: false });
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
        this.lastFrameTime = 0;
        this.frameBudgetMs = 1000 / 30; // 30fps cap

        // Layout constants
        this.pad = { top: 10, right: 15, bottom: 30, left: 50 };

        // Frequency axis labels (standard octave bands)
        this.freqLabels = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

        // Stats DOM refs
        this.statLeq = this.stats.querySelector('.stat-leq');
        this.statLpeak = this.stats.querySelector('.stat-lpeak');
        this.statCrest = this.stats.querySelector('.stat-crest');

        // Precomputed lookup tables (rebuilt on resize or FFT change)
        this._binXPositions = null; // Float32Array: X pixel for each bin index
        this._pixelBins = null;     // Array of {maxIdx, bins[]} per unique pixel column
        this._gridCanvas = null;    // Offscreen canvas for static grid
        this._gridDirty = true;

        // Resize observer for responsive canvas
        this._resizeObserver = new ResizeObserver(() => {
            this._resize();
            this._invalidateCaches();
        });
        this._resizeObserver.observe(this.canvas.parentElement);
        this._resize();
    }

    // ===== LAYOUT =====

    _resize() {
        const parent = this.canvas.parentElement;
        const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x
        const w = parent.clientWidth;
        const h = parent.clientHeight || 280;
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

    // ===== CACHE MANAGEMENT =====

    _invalidateCaches() {
        this._binXPositions = null;
        this._pixelBins = null;
        this._gridDirty = true;
    }

    _ensureBinCache() {
        const binCount = this.analyser.frequencyBinCount;
        if (this._binXPositions && this._binXPositions.length === binCount) return;

        const nyquist = this.sampleRate / 2;
        const minLog = Math.log10(20);
        const maxLog = Math.log10(nyquist);
        const logRange = maxLog - minLog;
        const plotW = this.plotW;

        // Precompute X position for every bin
        this._binXPositions = new Float32Array(binCount);
        for (let i = 0; i < binCount; i++) {
            const freq = (i / binCount) * nyquist;
            if (freq < 20) {
                this._binXPositions[i] = -1; // skip
            } else {
                this._binXPositions[i] = ((Math.log10(freq) - minLog) / logRange) * plotW;
            }
        }

        // Group bins by pixel column (pixel-binning)
        const pixelMap = new Map();
        for (let i = 1; i < binCount; i++) {
            const x = this._binXPositions[i];
            if (x < 0) continue;
            const px = Math.round(x);
            if (!pixelMap.has(px)) {
                pixelMap.set(px, []);
            }
            pixelMap.get(px).push(i);
        }

        // Convert to sorted array for fast iteration
        this._pixelBins = Array.from(pixelMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([px, bins]) => ({ px, bins }));
    }

    _ensureGridCache() {
        if (!this._gridDirty && this._gridCanvas) return;

        const W = this.displayWidth;
        const H = this.displayHeight;
        const pad = this.pad;
        const plotW = this.plotW;
        const plotH = this.plotH;
        const nyquist = this.sampleRate / 2;

        // Create or resize offscreen grid canvas
        if (!this._gridCanvas) {
            this._gridCanvas = document.createElement('canvas');
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this._gridCanvas.width = W * dpr;
        this._gridCanvas.height = H * dpr;
        const gctx = this._gridCanvas.getContext('2d');
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Clear
        gctx.clearRect(0, 0, W, H);
        gctx.save();
        gctx.translate(pad.left, pad.top);

        // dB grid lines
        gctx.strokeStyle = 'rgba(255,255,255,0.08)';
        gctx.lineWidth = 1;
        gctx.font = '10px Consolas, monospace';
        gctx.fillStyle = 'rgba(255,255,255,0.35)';
        gctx.textAlign = 'right';
        gctx.textBaseline = 'middle';

        const dbStep = (this.dbMax - this.dbMin) <= 60 ? 5 : 10;
        for (let db = this.dbMax; db >= this.dbMin; db -= dbStep) {
            const y = this._dbToY(db);
            gctx.beginPath();
            gctx.moveTo(0, y);
            gctx.lineTo(plotW, y);
            gctx.stroke();
            gctx.fillText(`${db}`, -5, y);
        }

        // Frequency grid lines
        const minLog = Math.log10(20);
        const maxLog = Math.log10(nyquist);
        const logRange = maxLog - minLog;

        gctx.textAlign = 'center';
        gctx.textBaseline = 'top';
        for (const freq of this.freqLabels) {
            if (freq > nyquist) continue;
            const x = ((Math.log10(freq) - minLog) / logRange) * plotW;
            gctx.beginPath();
            gctx.moveTo(x, 0);
            gctx.lineTo(x, plotH);
            gctx.stroke();

            const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
            gctx.fillText(label, x, plotH + 5);
        }

        // Plot border
        gctx.strokeStyle = 'rgba(0,255,255,0.15)';
        gctx.strokeRect(0, 0, plotW, plotH);

        gctx.restore();
        this._gridDirty = false;
    }

    // ===== PUBLIC API =====

    setDbRange(min, max) {
        this.dbMin = Math.max(-150, Math.min(min, max - 10));
        this.dbMax = Math.min(0, Math.max(max, min + 10));
        this._gridDirty = true;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
        this.peakHold = new Float32Array(this.dataArray.length).fill(-Infinity);
        this._invalidateCaches();
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
        if (this.statLeq) this.statLeq.textContent = '---';
        if (this.statLpeak) this.statLpeak.textContent = '---';
        if (this.statCrest) this.statCrest.textContent = '---';
    }

    updateAnalyser(analyser, sampleRate) {
        this.analyser = analyser;
        this.sampleRate = sampleRate;
        this.dataArray = new Float32Array(analyser.frequencyBinCount);
        this.peakHold = new Float32Array(this.dataArray.length).fill(-Infinity);
        this._invalidateCaches();
    }

    destroy() {
        this.stop();
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
        this._gridCanvas = null;
    }

    // ===== RENDER LOOP =====

    _loop(timestamp) {
        if (!this.isRunning) return;
        this.animFrameId = requestAnimationFrame((t) => this._loop(t));

        // 30fps throttle
        const elapsed = timestamp - this.lastFrameTime;
        if (elapsed < this.frameBudgetMs) return;
        this.lastFrameTime = timestamp;

        this._draw();
    }

    _dbToY(db) {
        const clamped = Math.max(this.dbMin, Math.min(this.dbMax, db));
        return this.plotH * (1 - (clamped - this.dbMin) / (this.dbMax - this.dbMin));
    }

    _draw() {
        const ctx = this.ctx2d;
        const W = this.displayWidth;
        const H = this.displayHeight;
        const pad = this.pad;
        const plotW = this.plotW;
        const plotH = this.plotH;

        // Ensure caches are warm
        this._ensureBinCache();
        this._ensureGridCache();

        // Get frequency data
        this.analyser.getFloatFrequencyData(this.dataArray);

        // 1. Clear to black
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        // 2. Blit cached grid (one drawImage call)
        ctx.drawImage(this._gridCanvas, 0, 0, W, H);

        // 3. Draw spectrum + peak hold using pixel-binned data
        ctx.save();
        ctx.translate(pad.left, pad.top);

        // Build pixel-binned max values (one pass over data)
        const pixelBins = this._pixelBins;
        const numPixels = pixelBins.length;
        const pixelMaxDB = new Float32Array(numPixels);
        const pixelPeakDB = new Float32Array(numPixels);

        for (let p = 0; p < numPixels; p++) {
            const { bins } = pixelBins[p];
            let maxDB = -Infinity;
            let peakDB = -Infinity;

            for (let b = 0; b < bins.length; b++) {
                const idx = bins[b];
                const val = this.dataArray[idx];
                if (val > maxDB) maxDB = val;

                // Update peak hold
                if (val > this.peakHold[idx]) {
                    this.peakHold[idx] = val;
                }
                if (this.peakHold[idx] > peakDB) peakDB = this.peakHold[idx];
            }

            // Decay peak hold for all bins in this pixel group
            for (let b = 0; b < bins.length; b++) {
                const idx = bins[b];
                if (this.dataArray[idx] <= this.peakHold[idx]) {
                    this.peakHold[idx] -= this.peakDecayRate;
                }
            }

            pixelMaxDB[p] = maxDB;
            pixelPeakDB[p] = peakDB;
        }

        // 4. Draw filled spectrum (single path)
        const gradient = ctx.createLinearGradient(0, 0, 0, plotH);
        gradient.addColorStop(0, 'rgba(0, 255, 255, 0.9)');
        gradient.addColorStop(0.3, 'rgba(0, 200, 255, 0.5)');
        gradient.addColorStop(0.7, 'rgba(0, 100, 200, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 50, 100, 0.05)');

        ctx.beginPath();
        ctx.moveTo(pixelBins[0].px, plotH);
        for (let p = 0; p < numPixels; p++) {
            ctx.lineTo(pixelBins[p].px, this._dbToY(pixelMaxDB[p]));
        }
        ctx.lineTo(pixelBins[numPixels - 1].px, plotH);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // 5. Draw bright edge stroke (reuse same points, no new path iteration)
        ctx.beginPath();
        ctx.moveTo(pixelBins[0].px, this._dbToY(pixelMaxDB[0]));
        for (let p = 1; p < numPixels; p++) {
            ctx.lineTo(pixelBins[p].px, this._dbToY(pixelMaxDB[p]));
        }
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(0, 255, 255, 0.6)';
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 6. Draw peak hold dots (pixel-binned, no per-bin iteration)
        ctx.fillStyle = 'rgba(255, 255, 0, 0.7)';
        for (let p = 0; p < numPixels; p += 2) { // every other pixel
            const y = this._dbToY(pixelPeakDB[p]);
            ctx.fillRect(pixelBins[p].px - 0.5, y - 0.5, 1.5, 1.5);
        }

        ctx.restore();

        // 7. Compute stats (single pass, already done during pixel-binning)
        this._computeStats(pixelMaxDB);
    }

    _computeStats(pixelMaxDB) {
        let sumPower = 0;
        let peak = -Infinity;
        const len = pixelMaxDB.length;

        for (let i = 0; i < len; i++) {
            const db = pixelMaxDB[i];
            if (!isFinite(db)) continue;
            sumPower += Math.pow(10, db / 10);
            if (db > peak) peak = db;
        }

        const leq = len > 0 ? 10 * Math.log10(sumPower / len) : -Infinity;
        const crest = peak - leq;

        if (this.statLeq) this.statLeq.textContent = isFinite(leq) ? leq.toFixed(1) : '---';
        if (this.statLpeak) this.statLpeak.textContent = isFinite(peak) ? peak.toFixed(1) : '---';
        if (this.statCrest) this.statCrest.textContent = isFinite(crest) ? crest.toFixed(1) : '---';
    }
}
