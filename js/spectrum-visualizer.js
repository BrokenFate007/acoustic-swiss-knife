// js/spectrum-visualizer.js
// Multi-view Spectrum Analyzer with A/C/Z weighting, Spectrogram, and Octave bands.

// ========== ISO Weighting Curves ==========
function computeAWeight(f) {
    if (f < 1) return -Infinity;
    const f2 = f * f, f4 = f2 * f2;
    const num = 148693636 * f4; // 12194^2 * f^4
    const den = (f2 + 424.36) * (f2 + 148693636) *
                Math.sqrt((f2 + 11599.29) * (f2 + 544496.41));
    return 20 * Math.log10(num / den) + 2.0;
}

function computeCWeight(f) {
    if (f < 1) return -Infinity;
    const f2 = f * f;
    const num = 148693636 * f2; // 12194^2 * f^2
    const den = (f2 + 424.36) * (f2 + 148693636);
    return 20 * Math.log10(num / den) + 0.062;
}

// ========== Octave Band Definitions ==========
const OCTAVE_BANDS_FULL = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const OCTAVE_BANDS_THIRD = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
    630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
    10000, 12500, 16000, 20000
];

// ========== Main Visualizer ==========
export class SpectrumVisualizer {
    constructor(canvas, statsContainer, analyser, sampleRate) {
        this.canvas = canvas;
        this.ctx2d = canvas.getContext('2d', { alpha: false });
        this.stats = statsContainer;
        this.analyser = analyser;
        this.sampleRate = sampleRate;

        // View mode
        this.viewMode = 'spectrum'; // 'spectrum' | 'spectrogram' | 'octave'

        // dB range
        this.dbMin = -120;
        this.dbMax = 0;

        // Weighting
        this.weighting = 'Z'; // 'Z' | 'A' | 'C'
        this._weightingLUT = null;

        // Peak hold
        this.peakHoldEnabled = false;
        this.peakHold = null;
        this.peakDecayRate = 0.3;

        // Decay speed mapping
        this._decayRates = { fast: 0.8, medium: 0.3, slow: 0.1, infinite: 0 };

        // Octave settings
        this.octaveBandType = 'third'; // 'full' | 'third'
        this._octaveBandCache = null;

        // Reference curve
        this.referenceData = null;

        // Freeze
        this.isFrozen = false;

        // Render state
        this.animFrameId = null;
        this.isRunning = false;
        this.lastFrameTime = 0;
        this.frameBudgetMs = 1000 / 30;

        // Layout
        this.pad = { top: 10, right: 15, bottom: 30, left: 50 };

        // Frequency labels
        this.freqLabels = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

        // Stats DOM refs
        this.statLeq = this.stats.querySelector('.stat-leq');
        this.statLpeak = this.stats.querySelector('.stat-lpeak');
        this.statCrest = this.stats.querySelector('.stat-crest');
        this.statClipping = this.stats.querySelector('.stat-clipping');

        // Caches
        this._binXPositions = null;
        this._pixelBins = null;
        this._gridCanvas = null;
        this._gridDirty = true;

        // Spectrogram offscreen
        this._spectrogramCanvas = null;
        this._spectrogramCtx = null;

        // Resize observer
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
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = parent.clientWidth;
        const h = parent.clientHeight || 300;
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

    // ===== PUBLIC API =====
    setView(mode) {
        this.viewMode = mode;
        this._gridDirty = true;
        // Reset spectrogram when switching to it
        if (mode === 'spectrogram') {
            this._initSpectrogram();
        }
    }

    setDbRange(min, max) {
        this.dbMin = Math.max(-150, Math.min(min, max - 10));
        this.dbMax = Math.min(0, Math.max(max, min + 10));
        this._gridDirty = true;
    }

    setWeighting(type) {
        this.weighting = type;
        this._weightingLUT = null; // Force recompute
        this._gridDirty = true;
    }

    setDecay(type) {
        this.peakDecayRate = this._decayRates[type] || 0.3;
    }

    setBands(type) {
        this.octaveBandType = type;
        this._octaveBandCache = null;
        this._gridDirty = true;
    }

    togglePeakHold() {
        this.peakHoldEnabled = !this.peakHoldEnabled;
        if (!this.peakHoldEnabled && this.peakHold) {
            this.peakHold.fill(-Infinity);
        }
        return this.peakHoldEnabled;
    }

    saveReference() {
        if (!this.dataArray) return;
        // Clone the current weighted data
        this.referenceData = new Float32Array(this._weightedData || this.dataArray);
    }

    clearReference() {
        this.referenceData = null;
    }

    toggleFreeze() {
        this.isFrozen = !this.isFrozen;
        return this.isFrozen;
    }

    exportPNG() {
        const link = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        link.download = `spectrum_${ts}.png`;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
        if (!this.peakHold || this.peakHold.length !== this.dataArray.length) {
            this.peakHold = new Float32Array(this.dataArray.length).fill(-Infinity);
        }
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
        if (this.statClipping) this.statClipping.classList.remove('clipping-active');
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
        if (this._resizeObserver) this._resizeObserver.disconnect();
        this._gridCanvas = null;
        this._spectrogramCanvas = null;
    }

    // ===== CACHE MANAGEMENT =====
    _invalidateCaches() {
        this._binXPositions = null;
        this._pixelBins = null;
        this._gridDirty = true;
        this._weightingLUT = null;
        this._octaveBandCache = null;
    }

    _ensureWeightingLUT() {
        if (this._weightingLUT) return;
        const binCount = this.analyser.frequencyBinCount;
        const nyquist = this.sampleRate / 2;
        this._weightingLUT = new Float32Array(binCount);

        if (this.weighting === 'Z') {
            this._weightingLUT.fill(0);
            return;
        }

        const weightFn = this.weighting === 'A' ? computeAWeight : computeCWeight;
        for (let i = 0; i < binCount; i++) {
            const freq = (i / binCount) * nyquist;
            this._weightingLUT[i] = weightFn(freq);
        }
    }

    _ensureBinCache() {
        const binCount = this.analyser.frequencyBinCount;
        if (this._binXPositions && this._binXPositions.length === binCount) return;

        const nyquist = this.sampleRate / 2;
        const minLog = Math.log10(20);
        const maxLog = Math.log10(nyquist);
        const logRange = maxLog - minLog;
        const plotW = this.plotW;

        this._binXPositions = new Float32Array(binCount);
        for (let i = 0; i < binCount; i++) {
            const freq = (i / binCount) * nyquist;
            this._binXPositions[i] = freq < 20 ? -1 :
                ((Math.log10(freq) - minLog) / logRange) * plotW;
        }

        const pixelMap = new Map();
        for (let i = 1; i < binCount; i++) {
            const x = this._binXPositions[i];
            if (x < 0) continue;
            const px = Math.round(x);
            if (!pixelMap.has(px)) pixelMap.set(px, []);
            pixelMap.get(px).push(i);
        }

        this._pixelBins = Array.from(pixelMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([px, bins]) => ({ px, bins }));
    }

    _ensureOctaveBandCache() {
        if (this._octaveBandCache) return;
        const centers = this.octaveBandType === 'full' ? OCTAVE_BANDS_FULL : OCTAVE_BANDS_THIRD;
        const factor = this.octaveBandType === 'full' ? Math.SQRT2 : Math.pow(2, 1 / 6);
        const binCount = this.analyser.frequencyBinCount;
        const nyquist = this.sampleRate / 2;
        const binWidth = nyquist / binCount;

        this._octaveBandCache = centers
            .filter(fc => fc <= nyquist)
            .map(fc => {
                const lo = fc / factor;
                const hi = fc * factor;
                const startBin = Math.max(1, Math.floor(lo / binWidth));
                const endBin = Math.min(binCount - 1, Math.ceil(hi / binWidth));
                return { fc, lo, hi, startBin, endBin };
            });
    }

    _ensureGridCache() {
        if (!this._gridDirty && this._gridCanvas) return;

        const W = this.displayWidth;
        const H = this.displayHeight;
        const pad = this.pad;
        const plotW = this.plotW;
        const plotH = this.plotH;
        const nyquist = this.sampleRate / 2;

        if (!this._gridCanvas) this._gridCanvas = document.createElement('canvas');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this._gridCanvas.width = W * dpr;
        this._gridCanvas.height = H * dpr;
        const gctx = this._gridCanvas.getContext('2d');
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        gctx.clearRect(0, 0, W, H);
        gctx.save();
        gctx.translate(pad.left, pad.top);

        // dB grid
        gctx.strokeStyle = 'rgba(255,255,255,0.08)';
        gctx.lineWidth = 1;
        gctx.font = '10px Consolas, monospace';
        gctx.fillStyle = 'rgba(255,255,255,0.35)';
        gctx.textAlign = 'right';
        gctx.textBaseline = 'middle';

        const dbStep = (this.dbMax - this.dbMin) <= 60 ? 5 : 10;
        for (let db = this.dbMax; db >= this.dbMin; db -= dbStep) {
            const y = this._dbToY(db);
            gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(plotW, y); gctx.stroke();
            gctx.fillText(`${db}`, -5, y);
        }

        // Frequency grid (only for spectrum/spectrogram)
        if (this.viewMode !== 'octave') {
            const minLog = Math.log10(20);
            const maxLog = Math.log10(nyquist);
            const logRange = maxLog - minLog;
            gctx.textAlign = 'center';
            gctx.textBaseline = 'top';
            for (const freq of this.freqLabels) {
                if (freq > nyquist) continue;
                const x = ((Math.log10(freq) - minLog) / logRange) * plotW;
                gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, plotH); gctx.stroke();
                const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
                gctx.fillText(label, x, plotH + 5);
            }
        }

        // Weighting label
        if (this.weighting !== 'Z') {
            gctx.fillStyle = 'rgba(255, 0, 255, 0.5)';
            gctx.font = 'bold 11px Consolas, monospace';
            gctx.textAlign = 'right';
            gctx.textBaseline = 'top';
            gctx.fillText(`dB${this.weighting}`, plotW - 4, 4);
        }

        // Border
        gctx.strokeStyle = 'rgba(0,255,255,0.15)';
        gctx.strokeRect(0, 0, plotW, plotH);

        gctx.restore();
        this._gridDirty = false;
    }

    // ===== SPECTROGRAM INIT =====
    _initSpectrogram() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (!this._spectrogramCanvas) {
            this._spectrogramCanvas = document.createElement('canvas');
        }
        this._spectrogramCanvas.width = this.plotW * dpr;
        this._spectrogramCanvas.height = this.plotH * dpr;
        this._spectrogramCtx = this._spectrogramCanvas.getContext('2d');
        this._spectrogramCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._spectrogramCtx.fillStyle = '#000';
        this._spectrogramCtx.fillRect(0, 0, this.plotW, this.plotH);
    }

    // ===== RENDER LOOP =====
    _loop(timestamp) {
        if (!this.isRunning) return;
        this.animFrameId = requestAnimationFrame((t) => this._loop(t));

        const elapsed = timestamp - this.lastFrameTime;
        if (elapsed < this.frameBudgetMs) return;
        this.lastFrameTime = timestamp;

        if (!this.isFrozen) {
            this._draw();
        }
    }

    _dbToY(db) {
        const clamped = Math.max(this.dbMin, Math.min(this.dbMax, db));
        return this.plotH * (1 - (clamped - this.dbMin) / (this.dbMax - this.dbMin));
    }

    _draw() {
        const ctx = this.ctx2d;
        const W = this.displayWidth;
        const H = this.displayHeight;

        this._ensureBinCache();
        this._ensureWeightingLUT();
        this._ensureGridCache();

        // Get FFT data and apply weighting
        this.analyser.getFloatFrequencyData(this.dataArray);
        const binCount = this.dataArray.length;

        // Apply weighting (creates weighted copy)
        if (!this._weightedData || this._weightedData.length !== binCount) {
            this._weightedData = new Float32Array(binCount);
        }
        for (let i = 0; i < binCount; i++) {
            this._weightedData[i] = this.dataArray[i] + this._weightingLUT[i];
        }

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        // Blit grid
        ctx.drawImage(this._gridCanvas, 0, 0, W, H);

        // Draw based on view mode
        ctx.save();
        ctx.translate(this.pad.left, this.pad.top);

        if (this.viewMode === 'spectrum') {
            this._drawSpectrum(ctx);
        } else if (this.viewMode === 'spectrogram') {
            this._drawSpectrogram(ctx);
        } else if (this.viewMode === 'octave') {
            this._drawOctave(ctx);
        }

        // Draw reference overlay (spectrum/spectrogram only)
        if (this.referenceData && this.viewMode === 'spectrum') {
            this._drawReference(ctx);
        }

        ctx.restore();

        // Compute stats
        this._computeStats();
    }

    // ===== SPECTRUM VIEW =====
    _drawSpectrum(ctx) {
        const plotW = this.plotW;
        const plotH = this.plotH;
        const pixelBins = this._pixelBins;
        const numPixels = pixelBins.length;
        if (numPixels === 0) return;

        // Pixel-binned max values
        const pixelMaxDB = new Float32Array(numPixels);
        for (let p = 0; p < numPixels; p++) {
            const { bins } = pixelBins[p];
            let maxDB = -Infinity;
            for (let b = 0; b < bins.length; b++) {
                const val = this._weightedData[bins[b]];
                if (val > maxDB) maxDB = val;
            }
            pixelMaxDB[p] = maxDB;
        }

        // Update peak hold
        this._updatePeakHold();

        // Filled spectrum
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

        // Edge stroke
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

        // Peak hold dots
        if (this.peakHoldEnabled) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
            for (let p = 0; p < numPixels; p += 2) {
                const { bins } = pixelBins[p];
                let peakDB = -Infinity;
                for (const idx of bins) {
                    if (this.peakHold[idx] > peakDB) peakDB = this.peakHold[idx];
                }
                const y = this._dbToY(peakDB);
                ctx.fillRect(pixelBins[p].px - 0.5, y - 0.5, 2, 2);
            }
        }
    }

    // ===== SPECTROGRAM VIEW =====
    _drawSpectrogram(ctx) {
        const plotW = this.plotW;
        const plotH = this.plotH;

        if (!this._spectrogramCtx) this._initSpectrogram();
        const sctx = this._spectrogramCtx;

        // Scroll existing content down by 1px
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        sctx.drawImage(this._spectrogramCanvas, 0, 0, plotW * dpr, (plotH - 1) * dpr, 0, dpr, plotW * dpr, (plotH - 1) * dpr);

        // Draw new row at top
        const pixelBins = this._pixelBins;
        const numPixels = pixelBins.length;

        sctx.save();
        sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (let p = 0; p < numPixels; p++) {
            const { px, bins } = pixelBins[p];
            let maxDB = -Infinity;
            for (const idx of bins) {
                const val = this._weightedData[idx];
                if (val > maxDB) maxDB = val;
            }

            // Map dB to color (our aesthetic: black → deep blue → cyan → magenta → white)
            const t = Math.max(0, Math.min(1, (maxDB - this.dbMin) / (this.dbMax - this.dbMin)));
            sctx.fillStyle = this._spectrogramColor(t);

            const nextPx = (p < numPixels - 1) ? pixelBins[p + 1].px : plotW;
            sctx.fillRect(px, 0, Math.max(1, nextPx - px), 1);
        }
        sctx.restore();

        // Blit spectrogram to main canvas
        ctx.drawImage(this._spectrogramCanvas, 0, 0, plotW * dpr, plotH * dpr, 0, 0, plotW, plotH);
    }

    _spectrogramColor(t) {
        // t: 0 (silence) → 1 (loudest)
        // Our lab aesthetic: black → dark cyan → cyan → magenta → white
        if (t < 0.2) {
            const s = t / 0.2;
            return `rgb(0, ${Math.round(s * 40)}, ${Math.round(s * 60)})`;
        } else if (t < 0.5) {
            const s = (t - 0.2) / 0.3;
            return `rgb(0, ${Math.round(40 + s * 215)}, ${Math.round(60 + s * 195)})`;
        } else if (t < 0.8) {
            const s = (t - 0.5) / 0.3;
            return `rgb(${Math.round(s * 255)}, ${Math.round(255 - s * 255)}, ${Math.round(255)})`;
        } else {
            const s = (t - 0.8) / 0.2;
            return `rgb(255, ${Math.round(s * 255)}, 255)`;
        }
    }

    // ===== OCTAVE VIEW =====
    _drawOctave(ctx) {
        this._ensureOctaveBandCache();
        const bands = this._octaveBandCache;
        if (!bands || bands.length === 0) return;

        const plotW = this.plotW;
        const plotH = this.plotH;
        const numBands = bands.length;
        const barGap = 2;
        const totalBarW = (plotW - (numBands - 1) * barGap) / numBands;
        const barW = Math.max(2, totalBarW);

        // Compute band levels
        const bandLevels = new Float32Array(numBands);
        for (let b = 0; b < numBands; b++) {
            const band = bands[b];
            let sumPower = 0;
            let count = 0;
            for (let i = band.startBin; i <= band.endBin; i++) {
                const db = this._weightedData[i];
                if (isFinite(db)) {
                    sumPower += Math.pow(10, db / 10);
                    count++;
                }
            }
            bandLevels[b] = count > 0 ? 10 * Math.log10(sumPower / count) : -Infinity;
        }

        // Update peak hold for octave (stored in separate array)
        if (!this._octavePeaks || this._octavePeaks.length !== numBands) {
            this._octavePeaks = new Float32Array(numBands).fill(-Infinity);
        }

        for (let b = 0; b < numBands; b++) {
            if (bandLevels[b] > this._octavePeaks[b]) {
                this._octavePeaks[b] = bandLevels[b];
            } else if (this.peakDecayRate > 0) {
                this._octavePeaks[b] -= this.peakDecayRate;
            }
        }

        // Draw bars
        for (let b = 0; b < numBands; b++) {
            const x = b * (barW + barGap);
            const db = bandLevels[b];
            const barH = Math.max(0, plotH - this._dbToY(db));
            const y = plotH - barH;

            // Bar gradient (bottom to top: dark cyan → bright cyan)
            const grad = ctx.createLinearGradient(x, plotH, x, y);
            grad.addColorStop(0, 'rgba(0, 80, 120, 0.8)');
            grad.addColorStop(0.5, 'rgba(0, 200, 255, 0.9)');
            grad.addColorStop(1, 'rgba(0, 255, 255, 1)');
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, barW, barH);

            // Bar glow
            ctx.shadowColor = 'rgba(0, 255, 255, 0.3)';
            ctx.shadowBlur = 4;
            ctx.fillRect(x, y, barW, Math.min(2, barH));
            ctx.shadowBlur = 0;

            // Peak hold marker
            if (this.peakHoldEnabled && isFinite(this._octavePeaks[b])) {
                const peakY = this._dbToY(this._octavePeaks[b]);
                ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
                ctx.fillRect(x, peakY - 1, barW, 2);
            }

            // dB value label on top of bar
            if (isFinite(db) && barH > 15) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.font = `${numBands > 15 ? 7 : 9}px Consolas, monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(Math.round(db), x + barW / 2, y - 2);
            }

            // Frequency label at bottom
            const fc = bands[b].fc;
            const label = fc >= 1000 ? `${(fc / 1000).toFixed(fc >= 10000 ? 0 : 1)}k` : `${fc}`;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.font = `${numBands > 15 ? 7 : 9}px Consolas, monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.save();
            ctx.translate(x + barW / 2, plotH + 3);
            if (numBands > 15) ctx.rotate(-Math.PI / 4);
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }
    }

    // ===== REFERENCE OVERLAY =====
    _drawReference(ctx) {
        if (!this.referenceData || !this._pixelBins) return;

        const pixelBins = this._pixelBins;
        const numPixels = pixelBins.length;

        ctx.beginPath();
        let started = false;
        for (let p = 0; p < numPixels; p++) {
            const { px, bins } = pixelBins[p];
            let maxDB = -Infinity;
            for (const idx of bins) {
                if (idx < this.referenceData.length) {
                    const val = this.referenceData[idx];
                    if (val > maxDB) maxDB = val;
                }
            }
            const y = this._dbToY(maxDB);
            if (!started) { ctx.moveTo(px, y); started = true; }
            else ctx.lineTo(px, y);
        }
        ctx.strokeStyle = 'rgba(255, 0, 255, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // ===== PEAK HOLD =====
    _updatePeakHold() {
        const data = this._weightedData;
        for (let i = 0; i < data.length; i++) {
            if (data[i] > this.peakHold[i]) {
                this.peakHold[i] = data[i];
            } else if (this.peakDecayRate > 0) {
                this.peakHold[i] -= this.peakDecayRate;
            }
        }
    }

    // ===== STATS =====
    _computeStats() {
        const data = this._weightedData;
        let sumPower = 0;
        let peak = -Infinity;
        let validCount = 0;
        let clipping = false;

        for (let i = 1; i < data.length; i++) {
            const db = data[i];
            if (!isFinite(db)) continue;
            sumPower += Math.pow(10, db / 10);
            if (db > peak) peak = db;
            if (db > -0.5) clipping = true;
            validCount++;
        }

        const leq = validCount > 0 ? 10 * Math.log10(sumPower / validCount) : -Infinity;
        const crest = peak - leq;

        if (this.statLeq) this.statLeq.textContent = isFinite(leq) ? leq.toFixed(1) : '---';
        if (this.statLpeak) this.statLpeak.textContent = isFinite(peak) ? peak.toFixed(1) : '---';
        if (this.statCrest) this.statCrest.textContent = isFinite(crest) ? crest.toFixed(1) : '---';
        if (this.statClipping) {
            if (clipping) this.statClipping.classList.add('clipping-active');
            else this.statClipping.classList.remove('clipping-active');
        }
    }
}
