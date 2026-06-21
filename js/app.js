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
                this.ui.selectSampleRate.disabled = true; 
                
                this.ui.signalStack.innerHTML = ''; // Clear offline message
                
                // Add initial tone automatically when powering on
                this.addToneRow();
                
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
            
            this.ui.signalStack.innerHTML = `
                <div class="empty-state" style="color: var(--text-secondary); text-align: center; font-family: var(--font-mono); padding: 2rem;">
                    AUDIO SYSTEM OFFLINE. POWER ON TO BEGIN.
                </div>
            `;
        }
    }

    async handleSampleRateChange() {
        // Will be used when system allows hot-swapping sample rate or before power on
        console.log(`Sample rate selected: ${this.ui.selectSampleRate.value}`);
    }

    addToneRow() {
        if (!this.isPoweredOn) {
            alert('Please POWER ON the system first.');
            return;
        }

        const tone = this.kernel.addTone();
        if (!tone) return;

        const row = document.createElement('div');
        row.className = 'signal-row';
        row.id = `row-${tone.id}`;

        row.innerHTML = `
            <div class="control-block">
                <label>Waveform</label>
                <select class="tone-type">
                    <option value="sine">Sine</option>
                    <option value="square">Square</option>
                    <option value="sawtooth">Sawtooth</option>
                    <option value="triangle">Triangle</option>
                </select>
            </div>
            <div class="control-block">
                <label>Frequency (Hz)</label>
                <input type="number" class="tone-freq" value="440" step="0.1" min="1" max="24000">
            </div>
            <div class="control-block">
                <label>Volume</label>
                <input type="range" class="tone-vol" value="0.5" min="0" max="1" step="0.01">
            </div>
            <div class="control-block">
                <label>Pan (L/R)</label>
                <input type="range" class="tone-pan" value="0" min="-1" max="1" step="0.01">
            </div>
            <div class="control-block" style="justify-content: flex-end; flex: 0;">
                <button class="danger btn-remove" style="width: 100%;">X</button>
            </div>
        `;

        // Bind Row Events
        row.querySelector('.tone-type').addEventListener('change', (e) => {
            this.kernel.updateTone(tone.id, 'type', e.target.value);
        });

        row.querySelector('.tone-freq').addEventListener('input', (e) => {
            this.kernel.updateTone(tone.id, 'frequency', e.target.value);
        });

        row.querySelector('.tone-vol').addEventListener('input', (e) => {
            this.kernel.updateTone(tone.id, 'volume', e.target.value);
        });

        row.querySelector('.tone-pan').addEventListener('input', (e) => {
            this.kernel.updateTone(tone.id, 'pan', e.target.value);
        });

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

        // Remove empty state if present
        const emptyState = this.ui.signalStack.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        this.ui.signalStack.appendChild(row);
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new AppController();
});
