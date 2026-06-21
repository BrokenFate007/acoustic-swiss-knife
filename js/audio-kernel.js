export class AudioKernel {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
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
        this.masterGain.connect(this.ctx.destination);
        
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

        gain.gain.value = 0.5;
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
                volume: 0.5,
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

    stopAll() {
        for (const id of this.tones.keys()) {
            this.removeTone(id);
        }
        if (this.ctx) {
            this.ctx.close();
            this.ctx = null;
            this.workletLoaded = false;
        }
    }
}
