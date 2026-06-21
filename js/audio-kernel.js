export class AudioKernel {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.tones = new Map();
        this.toneCounter = 0;
    }

    async init(sampleRateOption) {
        if (this.ctx) {
            await this.ctx.close();
        }

        const options = {
            latencyHint: 'interactive'
        };

        if (sampleRateOption !== 'auto') {
            options.sampleRate = parseInt(sampleRateOption, 10);
        }

        this.ctx = new (window.AudioContext || window.webkitAudioContext)(options);
        
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.5; // Default safety headroom (-6dB approx)
        this.masterGain.connect(this.ctx.destination);
        
        // Resume context in case browser requires it (e.g. Chrome autoplay policy)
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        
        console.log(`[AudioKernel] Initialized at ${this.ctx.sampleRate} Hz`);
        return this.ctx.sampleRate;
    }

    addTone() {
        if (!this.ctx) return null;

        const id = `tone-${this.toneCounter++}`;
        const osc = this.ctx.createOscillator();
        const panner = this.ctx.createStereoPanner();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.value = 440; // Default 440Hz

        gain.gain.value = 0.5;
        panner.pan.value = 0;

        osc.connect(panner);
        panner.connect(gain);
        gain.connect(this.masterGain);

        osc.start();

        const toneObj = {
            id,
            osc,
            panner,
            gain,
            state: {
                type: 'sine',
                frequency: 440,
                volume: 0.5,
                pan: 0
            }
        };

        this.tones.set(id, toneObj);
        return toneObj;
    }

    removeTone(id) {
        const toneObj = this.tones.get(id);
        if (toneObj) {
            toneObj.osc.stop();
            toneObj.osc.disconnect();
            toneObj.panner.disconnect();
            toneObj.gain.disconnect();
            this.tones.delete(id);
        }
    }

    updateTone(id, param, value) {
        const toneObj = this.tones.get(id);
        if (!toneObj) return;

        switch (param) {
            case 'type':
                toneObj.osc.type = value;
                toneObj.state.type = value;
                break;
            case 'frequency':
                toneObj.osc.frequency.setTargetAtTime(parseFloat(value), this.ctx.currentTime, 0.015);
                toneObj.state.frequency = parseFloat(value);
                break;
            case 'volume':
                toneObj.gain.gain.setTargetAtTime(parseFloat(value), this.ctx.currentTime, 0.015);
                toneObj.state.volume = parseFloat(value);
                break;
            case 'pan':
                toneObj.panner.pan.setTargetAtTime(parseFloat(value), this.ctx.currentTime, 0.015);
                toneObj.state.pan = parseFloat(value);
                break;
        }
    }
    
    stopAll() {
        for (const id of this.tones.keys()) {
            this.removeTone(id);
        }
        if (this.ctx) {
            this.ctx.close();
            this.ctx = null;
        }
    }
}
