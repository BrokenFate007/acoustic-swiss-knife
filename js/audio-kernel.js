export class AudioKernel {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.analyser = null;
        this.micSource = null;
        this.micStream = null;
        this.micMonitorGain = null;
        this.recorderDest = null;
        this.analysisMode = 'generator'; // 'generator' | 'mic' | 'both'
        this.tones = new Map();
        this.toneCounter = 0;
        this.workletLoaded = false;
    }

    async init(sampleRateOption) {
        if (this.ctx) {
            await this.ctx.close();
        }

        const options = { latencyHint: 'interactive' };
        if (sampleRateOption !== 'auto') {
            options.sampleRate = parseInt(sampleRateOption, 10);
        }

        this.ctx = new (window.AudioContext || window.webkitAudioContext)(options);
        
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.5;

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 8192;
        this.analyser.smoothingTimeConstant = 0.8;
        this.analyser.minDecibels = -120;
        this.analyser.maxDecibels = 0;

        this.masterGain.connect(this.analyser);        // generator → analyser (for analysis)
        this.masterGain.connect(this.ctx.destination);  // generator → speakers (always)

        // Mic monitor gain (muted by default to prevent feedback)
        this.micMonitorGain = this.ctx.createGain();
        this.micMonitorGain.gain.value = 0;
        this.micMonitorGain.connect(this.ctx.destination);

        // Recorder destination
        this.recorderDest = this.ctx.createMediaStreamDestination();
        
        try {
            await this.ctx.audioWorklet.addModule(`js/noise-worklet.js?v=${Date.now()}`);
            this.workletLoaded = true;
            console.log('[AudioKernel] AudioWorklet Loaded Successfully.');
        } catch (e) {
            console.error('[AudioKernel] Failed to load AudioWorklet:', e);
            alert('Failed to load DSP Worklet. Ensure you are running on localhost or HTTPS.');
        }

        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        
        return this.ctx.sampleRate;
    }

    addTone() {
        if (!this.ctx || !this.workletLoaded) {
            alert("Audio Engine not fully initialized yet.");
            return null;
        }

        const id = `tone-${this.toneCounter++}`;
        const source = this.ctx.createOscillator();
        source.type = 'sine';
        source.frequency.value = 440;

        const panner = this.ctx.createStereoPanner();
        const gain = this.ctx.createGain();

        gain.gain.value = 0.0;
        panner.pan.value = 0;

        source.connect(panner);
        panner.connect(gain);
        gain.connect(this.masterGain);

        source.start();

        const toneObj = {
            id,
            source,
            panner,
            gain,
            isWorklet: false,
            state: {
                type: 'sine',
                frequency: 440,
                volume: 0.0,
                pan: 0,
                startFreq: 20,
                endFreq: 20000,
                duration: 1.0,
                sweepMode: 'one-shot'
            },
            onProgress: null
        };

        this.tones.set(id, toneObj);
        return toneObj;
    }

    _swapSource(toneObj, newType) {
        const isStandard = ['sine', 'square', 'sawtooth', 'triangle'].includes(newType);
        
        if (toneObj.source) {
            if (toneObj.isWorklet) {
                toneObj.source.disconnect();
            } else {
                toneObj.source.stop();
                toneObj.source.disconnect();
            }
        }

        if (isStandard) {
            toneObj.source = this.ctx.createOscillator();
            toneObj.source.type = newType;
            toneObj.source.frequency.value = toneObj.state.frequency;
            toneObj.source.connect(toneObj.panner);
            toneObj.source.start();
            toneObj.isWorklet = false;
        } else {
            toneObj.source = new AudioWorkletNode(this.ctx, 'lab-signal-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2]
            });
            
            toneObj.source.port.postMessage({
                type: newType,
                startFreq: toneObj.state.startFreq,
                endFreq: toneObj.state.endFreq,
                duration: toneObj.state.duration,
                sweepMode: toneObj.state.sweepMode
            });

            toneObj.source.port.onmessage = (e) => {
                if (e.data.action === 'progress' && toneObj.onProgress) {
                    toneObj.onProgress(e.data.progress, e.data.freq);
                }
            };

            toneObj.source.connect(toneObj.panner);
            toneObj.isWorklet = true;
        }
    }

    updateTone(id, param, value) {
        const toneObj = this.tones.get(id);
        if (!toneObj) return;

        if (param === 'type') {
            const oldIsStandard = ['sine', 'square', 'sawtooth', 'triangle'].includes(toneObj.state.type);
            const newIsStandard = ['sine', 'square', 'sawtooth', 'triangle'].includes(value);
            
            if (oldIsStandard !== newIsStandard || !newIsStandard) {
                this._swapSource(toneObj, value);
            } else if (newIsStandard) {
                toneObj.source.type = value;
            }
            toneObj.state.type = value;
            return;
        }

        if (param === 'volume') {
            toneObj.gain.gain.setTargetAtTime(parseFloat(value), this.ctx.currentTime, 0.015);
            toneObj.state.volume = parseFloat(value);
        } else if (param === 'pan') {
            toneObj.panner.pan.setTargetAtTime(parseFloat(value), this.ctx.currentTime, 0.015);
            toneObj.state.pan = parseFloat(value);
        } else if (param === 'frequency') {
            toneObj.state.frequency = parseFloat(value);
            if (!toneObj.isWorklet) {
                toneObj.source.frequency.setTargetAtTime(parseFloat(value), this.ctx.currentTime, 0.015);
            }
        } else if (['startFreq', 'endFreq', 'duration', 'sweepMode'].includes(param)) {
            toneObj.state[param] = param === 'sweepMode' ? value : parseFloat(value);
            if (toneObj.isWorklet) {
                toneObj.source.port.postMessage({ [param]: toneObj.state[param] });
            }
        } else if (param === 'resetSweep') {
            if (toneObj.isWorklet) {
                toneObj.source.port.postMessage({ reset: true });
            }
        }
    }

    onProgress(id, callback) {
        const toneObj = this.tones.get(id);
        if (toneObj) {
            toneObj.onProgress = callback;
        }
    }

    removeTone(id) {
        const toneObj = this.tones.get(id);
        if (toneObj) {
            if (toneObj.isWorklet) {
                toneObj.source.disconnect();
            } else {
                toneObj.source.stop();
                toneObj.source.disconnect();
            }
            toneObj.panner.disconnect();
            toneObj.gain.disconnect();
            this.tones.delete(id);
        }
    }

    getAnalyser() {
        return this.analyser;
    }

    setFFTSize(size) {
        if (this.analyser) {
            this.analyser.fftSize = size;
        }
    }

    setSmoothing(value) {
        if (this.analyser) {
            this.analyser.smoothingTimeConstant = value;
        }
    }

    // ===== MIC INPUT =====
    async connectMic(deviceId) {
        // Stop any existing mic
        this.disconnectMic();

        const constraints = {
            audio: deviceId ? { deviceId: { exact: deviceId } } : true,
            video: false
        };

        try {
            this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.micSource = this.ctx.createMediaStreamSource(this.micStream);

            // Connect mic to monitor gain (user controls via setMonitor)
            this.micSource.connect(this.micMonitorGain);

            // Connect mic to recorder destination
            this.micSource.connect(this.recorderDest);

            // Apply analysis routing
            this._applyAnalysisRouting();

            console.log('[AudioKernel] Mic connected.');
            return true;
        } catch (e) {
            console.error('[AudioKernel] Mic access denied:', e);
            return false;
        }
    }

    disconnectMic() {
        if (this.micSource) {
            this.micSource.disconnect();
            this.micSource = null;
        }
        if (this.micStream) {
            this.micStream.getTracks().forEach(t => t.stop());
            this.micStream = null;
        }
    }

    setAnalysisMode(mode) {
        this.analysisMode = mode;
        this._applyAnalysisRouting();
    }

    _applyAnalysisRouting() {
        // Disconnect current analysis sources
        try { this.masterGain.disconnect(this.analyser); } catch(e) {}
        if (this.micSource) {
            try { this.micSource.disconnect(this.analyser); } catch(e) {}
        }

        // Reconnect based on mode
        if (this.analysisMode === 'generator' || this.analysisMode === 'both') {
            this.masterGain.connect(this.analyser);
        }
        if (this.micSource && (this.analysisMode === 'mic' || this.analysisMode === 'both')) {
            this.micSource.connect(this.analyser);
        }
    }

    setMonitor(enabled) {
        if (this.micMonitorGain) {
            this.micMonitorGain.gain.setTargetAtTime(enabled ? 1.0 : 0, this.ctx.currentTime, 0.015);
        }
    }

    getRecorderDestination() {
        return this.recorderDest;
    }

    stopAll() {
        this.disconnectMic();
        const ids = Array.from(this.tones.keys());
        for (const id of ids) {
            this.removeTone(id);
        }
        if (this.ctx) {
            this.ctx.close();
            this.ctx = null;
            this.analyser = null;
            this.micMonitorGain = null;
            this.recorderDest = null;
            this.workletLoaded = false;
        }
    }
}
