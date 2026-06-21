// js/noise-worklet.js
class LabSignalProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.type = 'sine'; // sine, square, sawtooth, triangle, white, pink, brown, sweep-lin, sweep-log
        this.sampleRate = sampleRate; 
        
        // Pink Noise State (Paul Kellet's filter)
        this.b0 = 0; this.b1 = 0; this.b2 = 0;
        this.b3 = 0; this.b4 = 0; this.b5 = 0; this.b6 = 0;
        
        // Brown Noise State
        this.lastOut = 0;

        // Sweep / Oscillator State
        this.frequency = 440;
        this.startFreq = 20;
        this.endFreq = 20000;
        this.duration = 1.0;
        this.sweepMode = 'one-shot'; // one-shot, loop, ping-pong
        this.currentPhase = 0;
        this.sweepTime = 0;
        this.sweepDirection = 1; 
        this.isPlaying = false;

        this.port.onmessage = (event) => {
            const data = event.data;
            if (data.type !== undefined) this.type = data.type;
            if (data.frequency !== undefined) this.frequency = Number(data.frequency);
            if (data.startFreq !== undefined) this.startFreq = Number(data.startFreq);
            if (data.endFreq !== undefined) this.endFreq = Number(data.endFreq);
            if (data.duration !== undefined) this.duration = Math.max(0.01, Number(data.duration));
            if (data.sweepMode !== undefined) this.sweepMode = data.sweepMode;
            if (data.reset) {
                this.sweepTime = 0;
                this.currentPhase = 0;
                this.sweepDirection = 1;
                this.isPlaying = true;
                
                this.port.postMessage({
                    action: 'progress',
                    progress: 0.0,
                    freq: this.startFreq
                });
            }
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channelCount = output.length;
        const bufferSize = output[0].length;

        // Throttle progress messages to UI
        let shouldReportProgress = false;
        let progressReportData = null;

        for (let i = 0; i < bufferSize; i++) {
            let outSample = 0;

            if (this.type === 'white') {
                outSample = Math.random() * 2 - 1;
            } 
            else if (this.type === 'pink') {
                let white = Math.random() * 2 - 1;
                this.b0 = 0.99886 * this.b0 + white * 0.0555179;
                this.b1 = 0.99332 * this.b1 + white * 0.0750759;
                this.b2 = 0.96900 * this.b2 + white * 0.1538520;
                this.b3 = 0.86650 * this.b3 + white * 0.3104856;
                this.b4 = 0.55000 * this.b4 + white * 0.5329522;
                this.b5 = -0.7616 * this.b5 - white * 0.0168980;
                outSample = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362;
                outSample *= 0.11; 
                this.b6 = white * 0.115926;
            }
            else if (this.type === 'brown') {
                let white = Math.random() * 2 - 1;
                outSample = (this.lastOut + (0.02 * white)) / 1.02;
                this.lastOut = outSample;
                outSample *= 3.5; 
            }
            else if (this.type === 'sweep-lin' || this.type === 'sweep-log') {
                if (!this.isPlaying) {
                    outSample = 0;
                } else {
                    let t = this.sweepTime / this.duration;
                    let currentFreq = 0;
                    
                    if (this.type === 'sweep-lin') {
                        currentFreq = this.startFreq + t * (this.endFreq - this.startFreq);
                    } else { 
                        currentFreq = this.startFreq * Math.pow(this.endFreq / this.startFreq, t);
                    }

                    this.currentPhase += currentFreq / this.sampleRate;
                    if (this.currentPhase > 1) this.currentPhase -= 1;

                    outSample = Math.sin(this.currentPhase * 2 * Math.PI);
                    this.sweepTime += (1 / this.sampleRate) * this.sweepDirection;

                    if (this.sweepDirection === 1 && this.sweepTime >= this.duration) {
                        if (this.sweepMode === 'one-shot') {
                            this.isPlaying = false;
                            this.sweepTime = this.duration;
                            currentFreq = this.endFreq;
                            
                            // Guarantee exact 100% UI update when completed
                            shouldReportProgress = true;
                            progressReportData = {
                                progress: 1.0,
                                freq: currentFreq
                            };
                        } else if (this.sweepMode === 'loop') {
                            this.sweepTime = 0; 
                        } else if (this.sweepMode === 'ping-pong') {
                            this.sweepTime = this.duration;
                            this.sweepDirection = -1;
                        }
                    } else if (this.sweepDirection === -1 && this.sweepTime <= 0) {
                        this.sweepTime = 0;
                        this.sweepDirection = 1; 
                    }
                    
                    if (i === 0 && Math.random() < 0.05 && !shouldReportProgress) { 
                        shouldReportProgress = true;
                        progressReportData = {
                            progress: this.sweepTime / this.duration,
                            freq: currentFreq
                        };
                    }
                }
            }

            for (let c = 0; c < channelCount; c++) {
                output[c][i] = outSample;
            }
        }

        if (shouldReportProgress && progressReportData) {
            this.port.postMessage({
                action: 'progress',
                ...progressReportData
            });
        }

        return true; 
    }
}

registerProcessor('lab-signal-processor', LabSignalProcessor);
