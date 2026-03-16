/**
 * Pomodoro Pro: Sovereign (Version 5.0)
 * Features: Procedural Soundscape, Command Palette, Focus Heatmap, PWA Engine
 */

import { createStore } from 'https://esm.sh/zustand@4.5.2/vanilla';
import { persist, createJSONStorage } from 'https://esm.sh/zustand@4.5.2/middleware';

// --- 1. SOVEREIGN AUDIO ENGINE (PROCEDURAL SYNTHESIS) ---
class SoundscapeEngine {
    constructor() {
        this.ctx = null;
        this.source = null;
        this.gainNode = null;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.gainNode = this.ctx.createGain();
            this.gainNode.connect(this.ctx.destination);
        }
    }

    createNoise(type) {
        this.stop();
        this.init();
        const bufferSize = 2 * this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = buffer.getChannelData(0);

        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            if (type === 'brown') {
                // Brown noise: Brownian motion (integration of white noise)
                output[i] = (lastOut + (0.02 * white)) / 1.02;
                lastOut = output[i];
                output[i] *= 3.5; // Volume compensation
            } else if (type === 'alpha') {
                // Alpha waves: 10Hz modulation
                output[i] = Math.sin(i * (2 * Math.PI * 10 / this.ctx.sampleRate)) * white;
            } else {
                output[i] = white; // White noise
            }
        }

        this.source = this.ctx.createBufferSource();
        this.source.buffer = buffer;
        this.source.loop = true;
        this.source.connect(this.gainNode);
        this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        this.gainNode.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + 2);
        this.source.start();
    }

    stop() {
        if (this.gainNode) {
            this.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1);
            setTimeout(() => { if (this.source) this.source.stop(); }, 1000);
        }
    }
}

const soundscape = new SoundscapeEngine();

// --- 2. TECHNICAL CORE: WORKER & HARDWARE ---
const workerCode = `
    let timerId = null;
    self.onmessage = (e) => {
        if (e.data.command === 'START') {
            timerId = setInterval(() => self.postMessage('TICK'), 1000);
        } else if (e.data.command === 'STOP') {
            clearInterval(timerId);
        }
    };
`;
const timerWorker = new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' })));

// --- 3. SOVEREIGN STATE ENGINE ---
const timerStore = createStore(
    persist(
        (set, get) => ({
            timeLeft: 1500,
            workDuration: 25,
            breakDuration: 5,
            isActive: false,
            isBreathing: false,
            mode: 'work',
            sessionsCompleted: 0,
            distractionCount: 0,
            currentIntention: "",
            audioType: 'none',
            history: [], // Array of {timestamp, type: 'work'}

            startTimer: async () => {
                const state = get();
                if (state.isActive || state.isBreathing) return;
                
                if (state.audioType !== 'none') soundscape.createNoise(state.audioType);
                
                const endTime = Date.now() + (state.timeLeft * 1000);
                set({ isActive: true, expectedEndTime: endTime });
                timerWorker.postMessage({ command: 'START' });
            },

            pauseTimer: () => {
                timerWorker.postMessage({ command: 'STOP' });
                soundscape.stop();
                set({ isActive: false, expectedEndTime: null });
            },

            tick: () => {
                const state = get();
                const remaining = Math.round((state.expectedEndTime - Date.now()) / 1000);
                if (remaining >= 0) set({ timeLeft: remaining });
                else get().completeSession();
            },

            completeSession: () => {
                const { mode, history, sessionsCompleted } = get();
                get().pauseTimer();
                
                const newHistory = [...history, { time: Date.now(), mode }];
                set({ 
                    isBreathing: true, 
                    history: newHistory,
                    sessionsCompleted: mode === 'work' ? sessionsCompleted + 1 : sessionsCompleted 
                });

                setTimeout(() => {
                    const nextMode = mode === 'work' ? 'break' : 'work';
                    set({ 
                        isBreathing: false, 
                        mode: nextMode, 
                        timeLeft: (nextMode === 'work' ? get().workDuration : get().breakDuration) * 60,
                        currentIntention: ""
                    });
                }, 15000);
            },

            setAudio: (type) => {
                set({ audioType: type });
                if (get().isActive) soundscape.createNoise(type);
                else soundscape.stop();
            }
        }),
        {
            name: 'sovereign-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ 
                history: state.history, 
                workDuration: state.workDuration, 
                breakDuration: state.breakDuration,
                sessionsCompleted: state.sessionsCompleted
            })
        }
    )
);

// --- 4. COMMAND PALETTE LOGIC ---
const executeCommand = (input) => {
    const [cmd, val] = input.toLowerCase().split(' ');
    const store = timerStore.getState();

    switch (cmd) {
        case 'work': store.updateSettings(val, store.breakDuration); break;
        case 'break': store.updateSettings(store.workDuration, val); break;
        case 'start': store.startTimer(); break;
        case 'pause': store.pauseTimer(); break;
        case 'reset': store.resetTimer(); break;
        case 'theme': document.body.setAttribute('data-theme', val); break;
        default: console.warn("Unknown command");
    }
};

// --- 5. DOM ORCHESTRATION ---
const elements = {
    timeLeft: document.getElementById('time-left'),
    startBtn: document.getElementById('start-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    palette: document.getElementById('command-palette'),
    paletteInput: document.getElementById('palette-input'),
    heatmap: document.getElementById('focus-heatmap'),
    audioType: document.getElementById('audio-type'),
    breathingOverlay: document.getElementById('breathing-overlay')
};

// Heatmap Generator
const renderHeatmap = () => {
    const history = timerStore.getState().history;
    const now = new Date();
    elements.heatmap.innerHTML = '';
    
    for (let i = 6; i >= 0; i--) {
        const day = new Date(now);
        day.setDate(day.getDate() - i);
        const count = history.filter(h => 
            new Date(h.time).toDateString() === day.toDateString() && h.mode === 'work'
        ).length;
        
        const level = Math.min(3, Math.floor(count / 2));
        const cell = document.createElement('div');
        cell.className = `cell level-${level}`;
        cell.title = `${count} sessions on ${day.toLocaleDateString()}`;
        elements.heatmap.appendChild(cell);
    }
};

// Keyboard Listeners
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        elements.palette.classList.toggle('hidden');
        if (!elements.palette.classList.contains('hidden')) elements.paletteInput.focus();
    }
    if (e.key === 'Escape') elements.palette.classList.add('hidden');
});

elements.paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        executeCommand(elements.paletteInput.value);
        elements.paletteInput.value = '';
        elements.palette.classList.add('hidden');
    }
});

// Store Subscriptions
timerStore.subscribe((state) => {
    elements.timeLeft.textContent = `${Math.floor(state.timeLeft/60).toString().padStart(2,'0')}:${(state.timeLeft%60).toString().padStart(2,'0')}`;
    elements.startBtn.hidden = state.isActive || state.isBreathing;
    elements.pauseBtn.hidden = !state.isActive;
    elements.breathingOverlay.classList.toggle('hidden', !state.isBreathing);
    document.body.className = `${state.mode}-mode`;
    if (state.isBreathing) renderHeatmap();
});

// Initial Bindings
elements.startBtn.onclick = () => timerStore.getState().startTimer();
elements.pauseBtn.onclick = () => timerStore.getState().pauseTimer();
elements.audioType.onchange = (e) => timerStore.getState().setAudio(e.target.value);
timerWorker.onmessage = () => timerStore.getState().tick();

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}

renderHeatmap();
