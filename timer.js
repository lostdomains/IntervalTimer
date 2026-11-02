/* Pure timer model. A clock can be injected for deterministic tests. */
(function (root) {
  'use strict';
  function buildIntervals(exercises) {
    return exercises.flatMap((exercise, index) => {
      const work = {kind: 'work', name: exercise.name, seconds: exercise.duration, exerciseIndex: index};
      return exercise.rest > 0 && index < exercises.length - 1
        ? [work, {kind: 'rest', name: 'Take a breather', seconds: exercise.rest, exerciseIndex: index}]
        : [work];
    });
  }
  class IntervalTimer {
    constructor(intervals, now = () => Date.now()) {
      this.intervals = intervals;
      this.now = now;
      this.total = intervals.reduce((sum, item) => sum + item.seconds * 1000, 0);
      this.reset();
    }
    reset() { this.index = 0; this.remaining = (this.intervals[0]?.seconds || 0) * 1000; this.state = 'ready'; this.deadline = 0; }
    start() {
      if (!this.intervals.length || this.state === 'running') return;
      if (this.state === 'complete') this.reset();
      this.deadline = this.now() + this.remaining;
      this.state = 'running';
    }
    pause() { if (this.state !== 'running') return; this.tick(); if (this.state === 'running') this.state = 'paused'; }
    tick() {
      if (this.state !== 'running') return;
      const currentTime = this.now();
      while (currentTime >= this.deadline) {
        this.index++;
        if (this.index >= this.intervals.length) { this.remaining = 0; this.state = 'complete'; return; }
        this.deadline += this.intervals[this.index].seconds * 1000;
      }
      this.remaining = Math.max(0, this.deadline - currentTime);
    }
    skip() {
      if (this.state === 'complete' || !this.intervals.length) return;
      this.index++;
      if (this.index >= this.intervals.length) { this.remaining = 0; this.state = 'complete'; return; }
      this.remaining = this.intervals[this.index].seconds * 1000;
      if (this.state === 'running') this.deadline = this.now() + this.remaining;
    }
    get current() { return this.intervals[this.index]; }
    get remainingTotal() { return this.remaining + this.intervals.slice(this.index + 1).reduce((sum, step) => sum + step.seconds * 1000, 0); }
  }
  root.TempoTimer = {buildIntervals, IntervalTimer};
  if (typeof module !== 'undefined') module.exports = root.TempoTimer;
})(typeof window !== 'undefined' ? window : globalThis);
