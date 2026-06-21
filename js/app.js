import { AudioKernel } from './audio-kernel.js';

class AppController {
    constructor() {
        this.kernel = new AudioKernel();
        this.isPoweredOn = false;

        this.ui = {
            btnPower: document.getElementById('btn-power'),
            btnAddTone: document.getElementById('btn-add-tone'),
            selectSampleRate: document.getElementById('master-samplerate'),
            signalStack: document.getElementById('signal-stack')
        };

        this.bindEvents();
    }

    bindEvents() {
        this.ui.btnPower.addEventListener('click', () => this.togglePower());
        this.ui.btnAddTone.addEventListener('click', () => this.addToneRow());
        this.ui.selectSampleRate.addEventListener('change', () => this.handleSampleRateChange());
    }

    async togglePower() {
        if (!this.isPoweredOn) {
            try {
                const sr = this.ui.selectSampleRate.value;
                const actualSr = await this.kernel.init(sr);
                this.isPoweredOn = true;
                this.ui.btnPower.textContent = 'POWER OFF';
                this.ui.btnPower.classList.add('danger');
                
                if (sr === 'auto') {
                    const autoOpt = this.ui.selectSampleRate.querySelector('option[value="auto"]');
                    if (autoOpt) autoOpt.textContent = `Device Default (${actualSr} Hz)`;
                }
                this._resolvedAutoText = sr === 'auto' ? `Device Default (${actualSr} Hz)` : null;
                
                this.ui.selectSampleRate.disabled = true; 
                
                this.ui.signalStack.innerHTML = `
                    <div class="empty-state" style="color: var(--text-secondary); text-align: center; font-family: var(--font-mono); padding: 2rem;">
                        SYSTEM ONLINE. ADD A SIGNAL TO BEGIN.
                    </div>
                `; 
                console.log(`System Online. Effective Sample Rate: ${actualSr} Hz`);
            } catch (err) {
                console.error("Failed to initialize Audio Engine:", err);
                alert("Failed to start audio engine. " + err.message);
            }
        } else {
            this.kernel.stopAll();
            this.isPoweredOn = false;
            this.ui.btnPower.textContent = 'POWER ON';
            this.ui.btnPower.classList.remove('danger');
            this.ui.selectSampleRate.disabled = false;
            
            // Reset the dropdown text if we modified it
            const autoOpt = this.ui.selectSampleRate.querySelector('option[value="auto"]');
            if (autoOpt) autoOpt.textContent = 'Auto (Device Default)';
            
            this.ui.signalStack.innerHTML = `
                <div class="empty-state" style="color: var(--text-secondary); text-align: center; font-family: var(--font-mono); padding: 2rem;">
                    AUDIO SYSTEM OFFLINE. POWER ON TO BEGIN.
                </div>
            `;
        }
    }

    async handleSampleRateChange() {
        console.log(`Sample rate selected: ${this.ui.selectSampleRate.value}`);
    }

    addToneRow() {
        if (!this.isPoweredOn) {
            alert('Please POWER ON the system first.');
            return;
        }

        const tone = this.kernel.addTone();
        if (!tone) return;

        // Remove the empty-state placeholder if present
        const emptyState = this.ui.signalStack.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const row = document.createElement('div');
        row.className = 'signal-row';
        row.id = `row-${tone.id}`;

        row.innerHTML = `
            <div class="control-block">
                <label>Waveform</label>
                <select class="tone-type">
                    <optgroup label="Tones">
                        <option value="sine">Sine</option>
                        <option value="square">Square</option>
                        <option value="sawtooth">Sawtooth</option>
                        <option value="triangle">Triangle</option>
                    </optgroup>
                    <optgroup label="Noise">
                        <option value="white">White Noise</option>
                        <option value="pink">Pink Noise (1/f)</option>
                        <option value="brown">Brown Noise (1/f²)</option>
                    </optgroup>
                    <optgroup label="Sweeps">
                        <option value="sweep-lin">Linear Sweep</option>
                        <option value="sweep-log">Logarithmic Sweep</option>
                    </optgroup>
                </select>
            </div>
            
            <div class="dynamic-controls" style="display: contents;">
                <!-- Filled dynamically based on type -->
            </div>

            <div class="control-block">
                <label>Volume: <input type="number" class="val-vol-input" value="0" min="0" max="100" style="width: 45px; padding: 0; margin: 0; height: auto; text-align: right; color: var(--accent-yellow); border: none !important; background: transparent; font-family: var(--font-mono); font-size: 0.85rem; outline: none;">%</label>
                <input type="range" class="tone-vol" value="0.0" min="0" max="1" step="0.01">
            </div>
            <div class="control-block">
                <label>Pan: <input type="number" class="val-pan-input" value="0" min="-100" max="100" style="width: 45px; padding: 0; margin: 0; height: auto; text-align: right; color: var(--accent-yellow); border: none !important; background: transparent; font-family: var(--font-mono); font-size: 0.85rem; outline: none;"></label>
                <input type="range" class="tone-pan" value="0" min="-1" max="1" step="0.01">
            </div>
            <div class="control-block" style="justify-content: flex-end; flex: 0;">
                <button class="danger btn-remove" style="width: 100%;">X</button>
            </div>
            <div class="sweep-progress-container" style="display: none; grid-column: 1 / -1; margin-top: 5px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--accent-yellow); margin-bottom: 2px;">
                    <span>Freq: <span class="sweep-freq-out">0</span> Hz</span>
                    <span><span class="sweep-time-out">0</span>%</span>
                </div>
                <div class="sweep-progress-bar" style="width: 100%; height: 4px; background: #222; border-radius: 2px; overflow: hidden;">
                    <div class="sweep-progress-fill" style="width: 0%; height: 100%; background: var(--accent-cyan);"></div>
                </div>
            </div>
        `;

        this.ui.signalStack.appendChild(row);
        this.renderDynamicControls(tone.id, row, 'sine', tone);

        // Bind Main Events
        row.querySelector('.tone-type').addEventListener('change', (e) => {
            this.kernel.updateTone(tone.id, 'type', e.target.value);
            this.renderDynamicControls(tone.id, row, e.target.value, tone);
        });

        const updateSliderStyle = (slider, percent) => {
            slider.style.background = `linear-gradient(to right, var(--accent-cyan) ${percent}%, #333 ${percent}%)`;
        };

        const valVolIn = row.querySelector('.val-vol-input');
        const sliderVol = row.querySelector('.tone-vol');
        
        sliderVol.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.kernel.updateTone(tone.id, 'volume', v);
            if (valVolIn) valVolIn.value = Math.round(v * 100);
            updateSliderStyle(sliderVol, v * 100);
        });
        
        if (valVolIn) {
            valVolIn.addEventListener('change', (e) => {
                let val = parseInt(e.target.value);
                if (isNaN(val)) val = 0;
                val = Math.max(0, Math.min(100, val));
                e.target.value = val;
                const v = val / 100.0;
                sliderVol.value = v;
                this.kernel.updateTone(tone.id, 'volume', v);
                updateSliderStyle(sliderVol, val);
            });
        }

        const valPanIn = row.querySelector('.val-pan-input');
        const sliderPan = row.querySelector('.tone-pan');
        
        sliderPan.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.kernel.updateTone(tone.id, 'pan', v);
            if (valPanIn) valPanIn.value = Math.round(v * 100);
            updateSliderStyle(sliderPan, (v + 1) * 50);
        });

        if (valPanIn) {
            valPanIn.addEventListener('change', (e) => {
                let val = parseInt(e.target.value);
                if (isNaN(val)) val = 0;
                val = Math.max(-100, Math.min(100, val));
                e.target.value = val;
                const v = val / 100.0;
                sliderPan.value = v;
                this.kernel.updateTone(tone.id, 'pan', v);
                updateSliderStyle(sliderPan, (v + 1) * 50);
            });
        }

        // Initialize background styling
        updateSliderStyle(sliderVol, parseFloat(sliderVol.value) * 100);
        updateSliderStyle(sliderPan, (parseFloat(sliderPan.value) + 1) * 50);

        row.querySelector('.btn-remove').addEventListener('click', () => {
            this.kernel.removeTone(tone.id);
            row.remove();
            if (this.ui.signalStack.children.length === 0) {
                 this.ui.signalStack.innerHTML = `
                    <div class="empty-state" style="color: var(--text-secondary); text-align: center; font-family: var(--font-mono); padding: 2rem;">
                        NO ACTIVE SIGNALS
                    </div>
                `;
            }
        });

        // Register Progress Callback
        this.kernel.onProgress(tone.id, (progress, freq) => {
            const fill = row.querySelector('.sweep-progress-fill');
            const freqOut = row.querySelector('.sweep-freq-out');
            const timeOut = row.querySelector('.sweep-time-out');
            if (fill) {
                fill.style.width = `${progress * 100}%`;
                freqOut.textContent = Math.round(freq);
                timeOut.textContent = Math.round(progress * 100);
            }
        });
    }

    renderDynamicControls(id, row, type, tone) {
        const container = row.querySelector('.dynamic-controls');
        const progressContainer = row.querySelector('.sweep-progress-container');
        
        progressContainer.style.display = 'none';

        if (['sine', 'square', 'sawtooth', 'triangle'].includes(type)) {
            container.innerHTML = `
                <div class="control-block">
                    <label>Frequency (Hz)</label>
                    <input type="number" class="tone-freq" value="440" step="0.1" min="1" max="24000">
                </div>
            `;
            container.querySelector('.tone-freq').addEventListener('input', (e) => {
                this.kernel.updateTone(id, 'frequency', e.target.value);
            });
        } 
        else if (['white', 'pink', 'brown'].includes(type)) {
            container.innerHTML = `
                <div class="control-block">
                    <label>Bandwidth</label>
                    <input type="text" value="Broadband" disabled style="opacity:0.5; text-align:center;">
                </div>
            `;
        }
        else if (['sweep-lin', 'sweep-log'].includes(type)) {
            progressContainer.style.display = 'block';
            container.innerHTML = `
                <div class="control-block">
                    <label>Start Freq (Hz)</label>
                    <input type="number" class="sweep-start" value="20" min="1" max="24000">
                </div>
                <div class="control-block">
                    <label>End Freq (Hz)</label>
                    <input type="number" class="sweep-end" value="20000" min="1" max="24000">
                </div>
                <div class="control-block">
                    <label>Duration (s)</label>
                    <input type="number" class="sweep-dur" value="${tone ? tone.state.duration : 1.0}" min="0.1" max="60" step="0.1">
                </div>
                <div class="control-block">
                    <label>Mode</label>
                    <select class="sweep-mode">
                        <option value="one-shot" ${tone && tone.state.sweepMode==='one-shot'?'selected':''}>One-Shot</option>
                        <option value="loop" ${tone && tone.state.sweepMode==='loop'?'selected':''}>Loop</option>
                        <option value="ping-pong" ${tone && tone.state.sweepMode==='ping-pong'?'selected':''}>Ping-Pong</option>
                    </select>
                </div>
                <div class="control-block">
                    <label>&nbsp;</label>
                    <button class="btn-restart-sweep" style="border-color: var(--accent-cyan); color: var(--accent-cyan);">Trigger</button>
                </div>
            `;
            
            container.querySelector('.sweep-start').addEventListener('input', (e) => {
                this.kernel.updateTone(id, 'startFreq', e.target.value);
            });
            container.querySelector('.sweep-end').addEventListener('input', (e) => {
                this.kernel.updateTone(id, 'endFreq', e.target.value);
            });
            container.querySelector('.sweep-dur').addEventListener('input', (e) => {
                this.kernel.updateTone(id, 'duration', e.target.value);
            });
            container.querySelector('.sweep-mode').addEventListener('change', (e) => {
                this.kernel.updateTone(id, 'sweepMode', e.target.value);
            });
            container.querySelector('.btn-restart-sweep').addEventListener('click', () => {
                this.kernel.updateTone(id, 'resetSweep', null);
            });
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new AppController();
});
