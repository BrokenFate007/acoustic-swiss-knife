// js/spl-meter.js
// Sound Pressure Level meter with Fast/Slow time weighting,
// A/C/Z frequency weighting, and 60-second history graph.

function computeAWeight(f) {
    if (f < 1) return -Infinity;
    const f2 = f * f, f4 = f2 * f2;
    const num = 148693636 * f4;
    const den = (f2 + 424.36) * (f2 + 148693636) *
                Math.sqrt((f2 + 11599.29) * (f2 + 544496.41));
    return 20 * Math.log10(num / den) + 2.0;
}

function computeCWeight(f) {
    if (f < 1) return -Infinity;
    const f2 = f * f;
    const num = 148693636 * f2;
    const den = (f2 + 424.36) * (f2 + 148693636);
    return 20 * Math.log10(num / den) + 0.062;
}

export class SPLMeter {
    constructor(canvas, statsContainer, analyser, sampleRate) {
        this.canvas = canvas;
        this.ctx2d = canvas.getContext('2d', { alpha: false });
        this.statsEl = statsContainer;
        this.analyser = analyser;
        this.sampleRate = sampleRate;

        // Settings
        this.weighting = 'Z';
        this.timeWeighting = 'fast'; // 'fast' (125ms) or 'slow' (1s)
        this.calibrationOffset = 0;  // dB offset for real SPL

        // State
        this.lp = -Infinity;        // Instantaneous level
        this.leq = -Infinity;       // Equivalent continuous level
        this.lmax = -Infinity;
        this.lmin = Infinity;
        this.smoothedLevel = -Infinity;
        this._powerSum = 0;
        this._sampleCount = 0;

        // History (60 seconds at ~30fps = ~1800 points, but we store 1/sec = 60 points)
        this.history = [];
        this.maxHistory = 60;
        this._historyTimer = 0;

        // Weighting LUT
        this._weightingLUT = null;

        // Render
        this.animFrameId = null;
        this.isRunning = false;
        this.lastFrameTime = 0;
        this.frameBudgetMs = 1000 / 30;

        // DOM refs
        this.elLp = this.statsEl.querySelector('.spl-lp');
        this.elLeq = this.statsEl.querySelector('.spl-leq');
        this.elLmax = this.statsEl.querySelector('.spl-lmax');
        this.elLmin = this.statsEl.querySelector('.spl-lmin');

        // Resize
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(this.canvas.parentElement);
        this._resize();
    }

    _resize() {
        const parent = this.canvas.parentElement;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = parent.clientWidth;
        const h = parent.clientHeight || 120;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.displayWidth = w;
        this.displayHeight = h;
    }

    _ensureWeightingLUT() {
        if (this._weightingLUT) return;
        const binCount = this.analyser.frequencyBinCount;
        const nyquist = this.sampleRate / 2;
        this._weightingLUT = new Float32Array(binCount);
        if (this.weighting === 'Z') { this._weightingLUT.fill(0); return; }
        const fn = this.weighting === 'A' ? computeAWeight : computeCWeight;
        for (let i = 0; i < binCount; i++) {
            this._weightingLUT[i] = fn((i / binCount) * nyquist);
        }
    }

    setWeighting(type) {
        this.weighting = type;
        this._weightingLUT = null;
    }

    setTimeWeighting(type) {
        this.timeWeighting = type;
    }

    setCalibration(offset) {
        this.calibrationOffset = parseFloat(offset) || 0;
    }

    reset() {
        this.leq = -Infinity;
        this.lmax = -Infinity;
        this.lmin = Infinity;
        this._powerSum = 0;
        this._sampleCount = 0;
        this.history = [];
        this.smoothedLevel = -Infinity;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
        this.lastFrameTime = 0;
        this.reset();
        this._loop(0);
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        this._clearDisplay();
    }

    updateAnalyser(analyser, sampleRate) {
        this.analyser = analyser;
        this.sampleRate = sampleRate;
        this.dataArray = new Float32Array(analyser.frequencyBinCount);
        this._weightingLUT = null;
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
        this._compute();
        this._drawHistory();
    }

    _compute() {
        this._ensureWeightingLUT();
        this.analyser.getFloatFrequencyData(this.dataArray);

        // Sum power across all bins with weighting
        let sumPower = 0;
        let count = 0;
        for (let i = 1; i < this.dataArray.length; i++) {
            const db = this.dataArray[i] + this._weightingLUT[i];
            if (!isFinite(db)) continue;
            sumPower += Math.pow(10, db / 10);
            count++;
        }

        // Instantaneous broadband level
        const rawLp = count > 0 ? 10 * Math.log10(sumPower / count) : -Infinity;
        this.lp = rawLp + this.calibrationOffset;

        // Time weighting (exponential moving average)
        const tau = this.timeWeighting === 'fast' ? 0.125 : 1.0;
        const dt = this.frameBudgetMs / 1000;
        const alpha = 1 - Math.exp(-dt / tau);

        if (!isFinite(this.smoothedLevel)) {
            this.smoothedLevel = this.lp;
        } else {
            this.smoothedLevel += alpha * (this.lp - this.smoothedLevel);
        }

        // Leq (energy average over all samples)
        if (isFinite(this.lp)) {
            this._powerSum += Math.pow(10, this.lp / 10);
            this._sampleCount++;
            this.leq = 10 * Math.log10(this._powerSum / this._sampleCount);
        }

        // Lmax / Lmin
        if (isFinite(this.smoothedLevel)) {
            if (this.smoothedLevel > this.lmax) this.lmax = this.smoothedLevel;
            if (this.smoothedLevel < this.lmin) this.lmin = this.smoothedLevel;
        }

        // History (store 1 value per second)
        this._historyTimer += dt;
        if (this._historyTimer >= 1.0) {
            this._historyTimer = 0;
            this.history.push(this.smoothedLevel);
            if (this.history.length > this.maxHistory) this.history.shift();
        }

        // Update DOM
        const fmt = (v) => isFinite(v) ? v.toFixed(1) : '---';
        if (this.elLp) this.elLp.textContent = fmt(this.smoothedLevel);
        if (this.elLeq) this.elLeq.textContent = fmt(this.leq);
        if (this.elLmax) this.elLmax.textContent = fmt(this.lmax);
        if (this.elLmin) this.elLmin.textContent = fmt(this.lmin);
    }

    _drawHistory() {
        const ctx = this.ctx2d;
        const W = this.displayWidth;
        const H = this.displayHeight;
        const pad = { top: 5, right: 5, bottom: 15, left: 35 };
        const plotW = W - pad.left - pad.right;
        const plotH = H - pad.top - pad.bottom;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        if (this.history.length < 2) return;

        ctx.save();
        ctx.translate(pad.left, pad.top);

        // Y axis: auto-range based on data
        const validHistory = this.history.filter(v => isFinite(v));
        if (validHistory.length === 0) { ctx.restore(); return; }
        const minDB = Math.floor((Math.min(...validHistory) - 5) / 10) * 10;
        const maxDB = Math.ceil((Math.max(...validHistory) + 5) / 10) * 10;
        const dbRange = maxDB - minDB || 20;

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.font = '9px Consolas, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let db = minDB; db <= maxDB; db += 10) {
            const y = plotH * (1 - (db - minDB) / dbRange);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
            ctx.fillText(`${db}`, -3, y);
        }

        // Time axis label
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('60s ago', 0, plotH + 2);
        ctx.fillText('now', plotW, plotH + 2);

        // Plot line
        ctx.beginPath();
        for (let i = 0; i < this.history.length; i++) {
            const x = (i / (this.maxHistory - 1)) * plotW;
            const y = plotH * (1 - (this.history[i] - minDB) / dbRange);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(0, 255, 255, 0.5)';
        ctx.shadowBlur = 4;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Border
        ctx.strokeStyle = 'rgba(0,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, plotW, plotH);

        ctx.restore();
    }

    _clearDisplay() {
        const ctx = this.ctx2d;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);
        const fmt = () => '---';
        if (this.elLp) this.elLp.textContent = fmt();
        if (this.elLeq) this.elLeq.textContent = fmt();
        if (this.elLmax) this.elLmax.textContent = fmt();
        if (this.elLmin) this.elLmin.textContent = fmt();
    }
}
