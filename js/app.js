import { AudioKernel } from './audio-kernel.js';
import { SpectrumVisualizer } from './spectrum-visualizer.js';
import { MicInput } from './mic-input.js';
import { AudioRecorder } from './audio-recorder.js';
import { SPLMeter } from './spl-meter.js';
import { Oscilloscope } from './oscilloscope.js';

class AppController {
    constructor() {
        this.kernel = new AudioKernel();
        this.isPoweredOn = false;

        this.ui = {
            btnPower: document.getElementById('btn-power'),
            btnAddTone: document.getElementById('btn-add-tone'),
            selectSampleRate: document.getElementById('master-samplerate'),
            selectFFTSize: document.getElementById('master-fftsize'),
            signalStack: document.getElementById('signal-stack'),
            spectrumCanvas: document.getElementById('spectrum-canvas'),
            statsStrip: document.getElementById('stats-strip'),
            dbMin: document.getElementById('db-min'),
            dbMax: document.getElementById('db-max'),
            // Wave 3.5: Analyzer controls
            viewTabs: document.querySelectorAll('.view-tab'),
            btnPeakHold: document.getElementById('btn-peak-hold'),
            btnSaveRef: document.getElementById('btn-save-ref'),
            btnFreeze: document.getElementById('btn-freeze'),
            btnExport: document.getElementById('btn-export'),
            selectWeighting: document.getElementById('setting-weighting'),
            sliderSmoothing: document.getElementById('setting-smoothing'),
            smoothingVal: document.getElementById('smoothing-val'),
            selectBands: document.getElementById('setting-bands'),
            selectDecay: document.getElementById('setting-decay'),
            // Wave 4: Mic, Recorder, Scope, SPL
            micDevice: document.getElementById('mic-device'),
            micMode: document.getElementById('mic-mode'),
            micMonitor: document.getElementById('mic-monitor'),
            monitorLabel: document.getElementById('monitor-label'),
            btnMicCapture: document.getElementById('btn-mic-capture'),
            recSource: document.getElementById('rec-source'),
            recBitDepth: document.getElementById('rec-bitdepth'),
            btnRecStart: document.getElementById('btn-rec-start'),
            btnRecStop: document.getElementById('btn-rec-stop'),
            recDuration: document.getElementById('rec-duration'),
            recIndicator: document.getElementById('rec-indicator'),
            scopeCanvas: document.getElementById('scope-canvas'),
            scopeTimescale: document.getElementById('scope-timescale'),
            btnScopeFreeze: document.getElementById('btn-scope-freeze'),
            btnScopeExport: document.getElementById('btn-scope-export'),
            splWeighting: document.getElementById('spl-weighting'),
            splTimeWeight: document.getElementById('spl-time-weight'),
            btnSplReset: document.getElementById('btn-spl-reset'),
            splStats: document.getElementById('spl-stats'),
            splHistoryCanvas: document.getElementById('spl-history-canvas'),
            splCalibration: document.getElementById('spl-calibration')
        };

        this.visualizer = null;
        this.micInput = null;
        this.recorder = null;
        this.oscilloscope = null;
        this.splMeter = null;

        this.bindEvents();
    }

    bindEvents() {
        this.ui.btnPower.addEventListener('click', () => this.togglePower());
        this.ui.btnAddTone.addEventListener('click', () => this.addToneRow());
        this.ui.selectSampleRate.addEventListener('change', () => this.handleSampleRateChange());

        // FFT Size control
        this.ui.selectFFTSize.addEventListener('change', (e) => {
            const size = parseInt(e.target.value, 10);
            this.kernel.setFFTSize(size);
            if (this.visualizer) {
                this.visualizer.updateAnalyser(this.kernel.getAnalyser(), this.kernel.ctx.sampleRate);
            }
        });

        // dB Range zoom controls
        const updateDbRange = () => {
            if (this.visualizer) {
                const min = parseInt(this.ui.dbMin.value, 10) || -120;
                const max = parseInt(this.ui.dbMax.value, 10) || 0;
                this.visualizer.setDbRange(min, max);
            }
        };
        this.ui.dbMin.addEventListener('change', updateDbRange);
        this.ui.dbMax.addEventListener('change', updateDbRange);

        // === WAVE 3.5: View Tabs ===
        this.ui.viewTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.ui.viewTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                if (this.visualizer) {
                    this.visualizer.setView(tab.dataset.view);
                }
            });
        });

        // === Toolbar Buttons ===
        this.ui.btnPeakHold.addEventListener('click', () => {
            if (this.visualizer) {
                const active = this.visualizer.togglePeakHold();
                this.ui.btnPeakHold.classList.toggle('active', active);
            }
        });

        this.ui.btnSaveRef.addEventListener('click', () => {
            if (this.visualizer) {
                if (this.visualizer.referenceData) {
                    this.visualizer.clearReference();
                    this.ui.btnSaveRef.classList.remove('active');
                } else {
                    this.visualizer.saveReference();
                    this.ui.btnSaveRef.classList.add('active');
                }
            }
        });

        this.ui.btnFreeze.addEventListener('click', () => {
            if (this.visualizer) {
                const frozen = this.visualizer.toggleFreeze();
                this.ui.btnFreeze.classList.toggle('active', frozen);
            }
        });

        this.ui.btnExport.addEventListener('click', () => {
            if (this.visualizer) this.visualizer.exportPNG();
        });

        // === Settings Controls ===
        this.ui.selectWeighting.addEventListener('change', (e) => {
            if (this.visualizer) this.visualizer.setWeighting(e.target.value);
        });

        this.ui.sliderSmoothing.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.kernel.setSmoothing(val);
            if (this.ui.smoothingVal) this.ui.smoothingVal.textContent = val.toFixed(2);
        });

        this.ui.selectBands.addEventListener('change', (e) => {
            if (this.visualizer) this.visualizer.setBands(e.target.value);
        });

        this.ui.selectDecay.addEventListener('change', (e) => {
            if (this.visualizer) this.visualizer.setDecay(e.target.value);
        });

        // ===== WAVE 4 BINDINGS =====

        // Mic capture
        this.ui.btnMicCapture.addEventListener('click', () => this._toggleMicCapture());

        this.ui.micMode.addEventListener('change', (e) => {
            if (this.micInput) this.micInput.setAnalysisMode(e.target.value);
        });

        this.ui.micMonitor.addEventListener('change', (e) => {
            if (this.micInput) {
                this.micInput.setMonitor(e.target.checked);
                this.ui.monitorLabel.textContent = e.target.checked ? 'ON' : 'OFF';
            }
        });

        // Recorder
        this.ui.btnRecStart.addEventListener('click', () => this._startRecording());
        this.ui.btnRecStop.addEventListener('click', () => this._stopRecording());

        // Oscilloscope
        this.ui.scopeTimescale.addEventListener('change', (e) => {
            if (this.oscilloscope) this.oscilloscope.setTimeScale(parseFloat(e.target.value));
        });

        this.ui.btnScopeFreeze.addEventListener('click', () => {
            if (this.oscilloscope) {
                const frozen = this.oscilloscope.toggleFreeze();
                this.ui.btnScopeFreeze.classList.toggle('active', frozen);
            }
        });

        this.ui.btnScopeExport.addEventListener('click', () => {
            if (this.oscilloscope) this.oscilloscope.exportPNG();
        });

        // SPL Meter
        this.ui.splWeighting.addEventListener('change', (e) => {
            if (this.splMeter) this.splMeter.setWeighting(e.target.value);
        });

        this.ui.splTimeWeight.addEventListener('change', (e) => {
            if (this.splMeter) this.splMeter.setTimeWeighting(e.target.value);
        });

        this.ui.btnSplReset.addEventListener('click', () => {
            if (this.splMeter) this.splMeter.reset();
        });

        this.ui.splCalibration.addEventListener('change', (e) => {
            if (this.splMeter) this.splMeter.setCalibration(e.target.value);
        });
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

                // Start spectrum visualizer
                const fftSize = parseInt(this.ui.selectFFTSize.value, 10);
                this.kernel.setFFTSize(fftSize);
                this.visualizer = new SpectrumVisualizer(
                    this.ui.spectrumCanvas,
                    this.ui.statsStrip,
                    this.kernel.getAnalyser(),
                    actualSr
                );
                const dbMin = parseInt(this.ui.dbMin.value, 10) || -120;
                const dbMax = parseInt(this.ui.dbMax.value, 10) || 0;
                this.visualizer.setDbRange(dbMin, dbMax);
                this.visualizer.start();

                // Start oscilloscope
                this.oscilloscope = new Oscilloscope(
                    this.ui.scopeCanvas,
                    this.kernel.getAnalyser(),
                    actualSr
                );
                this.oscilloscope.start();

                // Start SPL meter
                this.splMeter = new SPLMeter(
                    this.ui.splHistoryCanvas,
                    this.ui.splStats,
                    this.kernel.getAnalyser(),
                    actualSr
                );
                this.splMeter.start();

                // Initialize mic input and recorder
                this.micInput = new MicInput(this.kernel);
                this.recorder = new AudioRecorder(this.kernel);

                // Enumerate mic devices
                this._populateMicDevices();
            } catch (err) {
                console.error("Failed to initialize Audio Engine:", err);
                alert("Failed to start audio engine. " + err.message);
            }
        } else {
            this.kernel.stopAll();

            // Stop spectrum visualizer
            if (this.visualizer) {
                this.visualizer.destroy();
                this.visualizer = null;
            }

            // Stop oscilloscope
            if (this.oscilloscope) {
                this.oscilloscope.destroy();
                this.oscilloscope = null;
            }

            // Stop SPL meter
            if (this.splMeter) {
                this.splMeter.destroy();
                this.splMeter = null;
            }

            // Stop mic & recorder
            if (this.micInput && this.micInput.isCapturing) {
                this.micInput.stopCapture();
                this.ui.btnMicCapture.textContent = 'Start Capture';
                this.ui.btnMicCapture.classList.remove('capturing');
            }
            this._stopRecording();
            this.micInput = null;
            this.recorder = null;

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

    // ===== WAVE 4 HELPERS =====

    async _populateMicDevices() {
        if (!this.micInput) return;
        const devices = await this.micInput.enumerateDevices();
        this.ui.micDevice.innerHTML = '<option value="">Select Microphone...</option>';
        for (const d of devices) {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label;
            this.ui.micDevice.appendChild(opt);
        }
    }

    async _toggleMicCapture() {
        if (!this.micInput || !this.isPoweredOn) return;

        if (this.micInput.isCapturing) {
            this.micInput.stopCapture();
            this.ui.btnMicCapture.textContent = 'Start Capture';
            this.ui.btnMicCapture.classList.remove('capturing');
        } else {
            const deviceId = this.ui.micDevice.value || null;
            const success = await this.micInput.startCapture(deviceId);
            if (success) {
                // Apply current analysis mode
                this.micInput.setAnalysisMode(this.ui.micMode.value);
                this.ui.btnMicCapture.textContent = 'Stop Capture';
                this.ui.btnMicCapture.classList.add('capturing');

                // Re-enumerate to get labels (now that permission is granted)
                await this._populateMicDevices();
            } else {
                alert('Could not access microphone. Check permissions.');
            }
        }
    }

    _startRecording() {
        if (!this.recorder || !this.isPoweredOn) return;
        this.recorder.source = this.ui.recSource.value;
        this.recorder.bitDepth = parseInt(this.ui.recBitDepth.value, 10);
        this.recorder.onTick = (elapsed) => {
            const min = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const sec = Math.floor(elapsed % 60).toString().padStart(2, '0');
            this.ui.recDuration.textContent = `${min}:${sec}`;
        };
        this.recorder.start();
        this.ui.btnRecStart.classList.add('recording');
        this.ui.btnRecStart.disabled = true;
        this.ui.btnRecStop.disabled = false;
        this.ui.recIndicator.classList.add('active');
    }

    _stopRecording() {
        if (!this.recorder || !this.recorder.isRecording) return;
        this.recorder.stop();
        this.ui.btnRecStart.classList.remove('recording');
        this.ui.btnRecStart.disabled = false;
        this.ui.btnRecStop.disabled = true;
        this.ui.recIndicator.classList.remove('active');
        this.ui.recDuration.textContent = '00:00';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new AppController();
});
