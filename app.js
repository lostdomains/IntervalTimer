'use strict';

const $ = (selector) => document.querySelector(selector);
const {IntervalTimer, buildIntervals} = window.TempoTimer;
const STORAGE_KEY = 'tempo.workouts.v1';
const THEME_KEY = 'tempo.theme';
const SOUND_KEY = 'tempo.sound';
const icons = {
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  orange: '<path d="m14 2-9 12h7l-2 8 9-12h-7z"/>',
  purple: '<path d="m12 3 9 9-9 9-9-9zM7 12h10M12 7v10"/>',
  green: '<path d="M20 4C8 2 2 8 6 16c8 4 14-2 14-12ZM5 21 16 10"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  moon: '<path d="M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 4-6 5H2v6h3l6 5zM16 9l6 6M22 9l-6 6"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.clock}</svg>`; }
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char])); }
function uid() { return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function readPreference(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writePreference(key, value) { try { localStorage.setItem(key, value); } catch { /* Preferences remain active for this page. */ } }
function durationLabel(seconds) { const s = Math.ceil(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function totalSeconds(workout) { return buildIntervals(workout.exercises).reduce((sum, step) => sum + step.seconds, 0); }
let workouts = [], selectedId = null, timer = null, editor = null, toastTimeout, audioContext, lastAnnouncement = '', fileLoadFailed = false;
let soundEnabled = readPreference(SOUND_KEY) !== 'off';
let wakeLock = null, requestingWakeLock = false;
const activeWorkout = () => workouts.find(workout => workout.id === selectedId);

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({version: 1, workouts}));
    $('.local-note').textContent = '◌ Saved on this device';
    return true;
  } catch {
    $('.local-note').textContent = 'Unsaved — export to keep changes';
    toast('Browser storage is unavailable or full. Export JSON to keep your changes.');
    return false;
  }
}

// Validate the entire file before changing anything. Never insert file content as HTML.
function validateData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.workouts)) throw new Error('Use a JSON file with version: 1 and a workouts array.');
  if (data.workouts.length > 200) throw new Error('A file can contain up to 200 workouts.');
  const ids = new Set();
  const getId = (id) => { const result = typeof id === 'string' && id.length <= 100 && id && !ids.has(id) ? id : uid(); ids.add(result); return result; };
  const text = (value, max, label, optional = false) => {
    if (optional && value === undefined) return '';
    if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) throw new Error(`${label} must be ${optional ? 'at most' : '1–'}${max} characters.`);
    return value.trim();
  };
  const seconds = (value, min, label) => {
    if (!Number.isInteger(value) || value < min || value > 3600) throw new Error(`${label} must be a whole number from ${min} to 3600 seconds.`);
    return value;
  };
  return data.workouts.map(workout => {
    if (!workout || !Array.isArray(workout.exercises) || workout.exercises.length > 200) throw new Error('Each workout needs an exercises array with at most 200 exercises.');
    return {
      id: getId(workout.id), name: text(workout.name, 80, 'Workout name'),
      description: text(workout.description, 240, 'Description', true),
      color: ['orange', 'purple', 'green'].includes(workout.color) ? workout.color : 'orange',
      exercises: workout.exercises.map(exercise => {
        if (!exercise) throw new Error('Every exercise must be an object.');
        return {id: getId(exercise.id), name: text(exercise.name, 80, 'Exercise name'), duration: seconds(exercise.duration, 1, 'Work duration'), rest: seconds(exercise.rest ?? 0, 0, 'Rest duration')};
      })
    };
  });
}

function renderLibrary() {
  $('#workout-count').textContent = `${workouts.length} workout${workouts.length === 1 ? '' : 's'} in your collection`;
  $('#workout-grid').innerHTML = workouts.length ? workouts.map(workout => `
    <article class="workout-card">
      <div class="card-top"><span class="workout-symbol ${workout.color}">${icon(workout.color)}</span><button class="icon-button" data-action="delete-workout" data-id="${escapeHTML(workout.id)}" aria-label="Delete ${escapeHTML(workout.name)}" title="Delete workout">${icon('trash')}</button></div>
      <h3>${escapeHTML(workout.name)}</h3><p class="description">${escapeHTML(workout.description || 'A little time dedicated to you.')}</p>
      <div class="card-stats"><span>${icon('clock')}${durationLabel(totalSeconds(workout))} total</span><span>${icon('list')}${workout.exercises.length} exercises</span></div>
      <button class="button card-open" data-action="open-workout" data-id="${escapeHTML(workout.id)}" aria-label="Open ${escapeHTML(workout.name)}">Open workout <span aria-hidden="true">↗</span></button>
    </article>`).join('') : `<div class="empty-state"><h2>${fileLoadFailed ? 'Let’s load your workouts' : 'Your next chapter starts here'}</h2><p>${fileLoadFailed ? 'Use Import JSON to select workouts.json, or create your first workout.' : 'Create a workout or import a JSON file to get moving.'}</p></div>`;
}
function renderExercises() {
  cancelExerciseDrag();
  const workout = activeWorkout();
  $('#exercise-count').textContent = `${workout.exercises.length} exercises`;
  $('#exercise-list').innerHTML = workout.exercises.length ? workout.exercises.map((exercise, index) => `
    <li>
      <div class="exercise-row" data-index="${index}">
        <button type="button" class="drag-handle" data-drag-id="${escapeHTML(exercise.id)}" aria-label="Move ${escapeHTML(exercise.name)}" aria-describedby="reorder-help" title="Drag to reorder, or use the arrow keys" ${workout.exercises.length < 2 ? 'disabled' : ''}>
          <span class="drag-grip" aria-hidden="true">⠿</span>
          <span class="exercise-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
        </button>
        <div class="exercise-info"><strong>${escapeHTML(exercise.name)}</strong><span class="exercise-duration">${exercise.duration} sec work</span></div>
        <button class="icon-button" data-action="edit-exercise" data-id="${escapeHTML(exercise.id)}" aria-label="Edit ${escapeHTML(exercise.name)}" title="Edit exercise">${icon('edit')}</button>
        <button class="icon-button" data-action="delete-exercise" data-id="${escapeHTML(exercise.id)}" aria-label="Delete ${escapeHTML(exercise.name)}" title="Delete exercise">${icon('trash')}</button>
      </div>
      ${index < workout.exercises.length - 1 ? `<div class="rest-row" data-rest-index="${index}">${exercise.rest ? `${exercise.rest} sec rest` : 'Straight into the next exercise'}</div>` : '<div class="rest-row">Finish strong</div>'}
    </li>`).join('') : '<li class="empty-state"><h3>A fresh lineup</h3><p>Add your first exercise below.</p></li>';
}
function resetSession() {
  timer = new IntervalTimer(buildIntervals(activeWorkout().exercises));
  lastAnnouncement = '';
  renderWorkout();
  syncWakeLock();
}
function renderWorkout() {
  const workout = activeWorkout();
  $('#workout-title').textContent = workout.name;
  $('#workout-description').textContent = workout.description || 'One interval at a time.';
  renderExercises();
  renderTimer();
}
function renderTimer() {
  if (!timer || $('#workout-view').hidden) return;
  const workout = activeWorkout(), step = timer.current;
  const done = timer.state === 'complete', empty = !timer.intervals.length;
  const running = timer.state === 'running', paused = timer.state === 'paused';
  const seconds = Math.ceil(timer.remaining / 1000);
  $('#phase-badge').textContent = done ? 'WORKOUT COMPLETE' : empty ? 'BUILD YOUR WORKOUT' : paused ? 'PAUSED' : running ? step.kind === 'rest' ? 'REST & RECOVER' : 'WORK INTERVAL' : 'READY WHEN YOU ARE';
  $('#current-exercise').textContent = done ? 'You showed up. Well done.' : empty ? 'Your pace starts here' : step.name;
  $('#step-count').textContent = empty ? '' : `${done ? workout.exercises.length : step.exerciseIndex + 1} / ${workout.exercises.length}`;
  $('#time-left').textContent = done ? '✓' : seconds;
  $('#time-left').setAttribute('aria-label', done ? 'Workout complete' : `${seconds} seconds remaining`);
  $('#time-left').style.fontSize = seconds > 999 ? '56px' : '';
  $('#timer-unit').textContent = done ? 'NICE WORK' : 'SECONDS';
  $('#clock-progress').style.strokeDashoffset = empty ? 100 : done ? 0 : 100 * (1 - timer.remaining / (step.seconds * 1000));
  $('.timer-panel').classList.toggle('is-rest', step?.kind === 'rest');
  const next = timer.intervals[timer.index + 1];
  $('#up-next').textContent = done ? 'Take a breath. You earned it.' : empty ? 'Add an exercise to start your timer.' : next ? `Up next: ${next.kind === 'rest' ? 'Rest' : next.name} · ${next.seconds} sec` : 'Last interval. Make it yours.';
  $('#play-button').textContent = done ? 'Start again' : running ? 'Ⅱ Pause' : paused ? '▶ Resume' : '▶ Start workout';
  $('#play-button').disabled = empty;
  $('#skip-button').disabled = done || empty;
  $('#reset-button').disabled = empty || timer.state === 'ready' && timer.index === 0;
  $('#session-status').textContent = done ? 'Workout complete' : paused ? 'Session paused' : running ? 'Finding your rhythm' : 'Ready to begin';
  $('#session-remaining').textContent = `${durationLabel(timer.remainingTotal / 1000)} remaining`;
  $('#session-progress').value = timer.total ? 100 * (1 - timer.remainingTotal / timer.total) : 0;
  document.querySelectorAll('.exercise-row').forEach(row => {
    const index = Number(row.dataset.index), exercise = workout.exercises[index];
    const current = !done && step?.exerciseIndex === index && step.kind === 'work';
    row.classList.toggle('active', current);
    const finished = done || step && (index < step.exerciseIndex || index === step.exerciseIndex && step.kind === 'rest');
    row.querySelector('.exercise-number').textContent = finished ? '✓' : String(index + 1).padStart(2, '0');
    row.querySelector('.exercise-duration').textContent = `${current ? seconds : exercise.duration} sec ${finished ? '· complete' : 'work'}`;
  });
  document.querySelectorAll('.rest-row[data-rest-index]').forEach(row => {
    const index = Number(row.dataset.restIndex), current = step?.kind === 'rest' && step.exerciseIndex === index;
    row.classList.toggle('active', current);
    row.textContent = current ? `${seconds} sec rest remaining` : workout.exercises[index].rest ? `${workout.exercises[index].rest} sec rest` : 'Straight into the next exercise';
  });
  const announcement = `${timer.index}-${timer.state}`;
  if (announcement !== lastAnnouncement) {
    $('#announcer').textContent = done ? 'Workout complete. Well done!' : `${$('#phase-badge').textContent}. ${step?.name || 'Add an exercise'}. ${seconds} seconds.`;
    lastAnnouncement = announcement;
  }
}
function route() {
  cancelExerciseDrag();
  let id;
  try { id = decodeURIComponent(location.hash.replace(/^#workout=/, '')); } catch { id = ''; }
  const workout = workouts.find(item => item.id === id);
  if (timer?.state === 'running') { timer.pause(); toast('Workout paused. Resume when you’re ready.'); }
  $('#library-view').hidden = !!workout;
  $('#workout-view').hidden = !workout;
  if (workout) {
    if (selectedId !== id || !timer) { selectedId = id; resetSession(); }
    else renderWorkout();
  } else renderLibrary();
  syncWakeLock();
}

function openEditor(type, id = null) {
  if (timer?.state === 'running') { timer.pause(); renderTimer(); syncWakeLock(); }
  editor = {type, id};
  const isWorkout = type === 'workout';
  const item = isWorkout ? workouts.find(item => item.id === id) : activeWorkout().exercises.find(item => item.id === id);
  $('#editor-title').textContent = `${id ? 'Edit' : 'New'} ${isWorkout ? 'workout' : 'exercise'}`;
  $('#editor-fields').innerHTML = `<label for="item-name">${isWorkout ? 'Workout' : 'Exercise'} name</label><input id="item-name" name="name" maxlength="80" required placeholder="${isWorkout ? 'e.g. Morning momentum' : 'e.g. Jumping jacks'}" value="${escapeHTML(item?.name || '')}">` + (isWorkout
    ? `<label for="item-description">Description <span class="muted">(optional)</span></label><textarea id="item-description" name="description" maxlength="240" placeholder="What’s the focus?">${escapeHTML(item?.description || '')}</textarea><label for="item-color">Accent color</label><select id="item-color" name="color"><option value="orange">Warm orange</option><option value="purple">Soft purple</option><option value="green">Sage green</option></select>`
    : `<div class="field-pair"><div><label for="item-duration">Work (seconds)</label><input id="item-duration" name="duration" type="number" min="1" max="3600" step="1" required value="${item?.duration ?? 40}"></div><div><label for="item-rest">Rest after (seconds)</label><input id="item-rest" name="rest" type="number" min="0" max="3600" step="1" required value="${item?.rest ?? 20}"></div></div><p class="field-help">Rest runs between exercises only. Set it to 0 to skip it. Saving resets your current session.</p>`);
  if (isWorkout) $('#item-color').value = item?.color || 'orange';
  $('#editor-error').textContent = '';
  $('#editor-dialog').showModal();
  $('#item-name').focus();
}
async function confirmAction(title, description, action = 'Delete') {
  $('#confirm-title').textContent = title;
  $('#confirm-description').textContent = description;
  $('#confirm-dialog [value="confirm"]').textContent = action;
  $('#confirm-dialog [value="confirm"]').classList.toggle('danger', action === 'Delete');
  $('#confirm-dialog [value="confirm"]').classList.toggle('primary', action !== 'Delete');
  const dialog = $('#confirm-dialog');
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once: true}));
}
$('#editor-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget), name = form.get('name').trim();
  if (!name) { $('#editor-error').textContent = 'Please enter a name.'; return; }
  if (editor.type === 'workout') {
    const existing = workouts.find(workout => workout.id === editor.id);
    const fields = {name, description: form.get('description').trim(), color: form.get('color')};
    if (existing) { Object.assign(existing, fields); if (activeWorkout()) renderWorkout(); }
    else {
      if (workouts.length >= 200) { $('#editor-error').textContent = 'Maximum of 200 workouts reached.'; return; }
      const workout = {id: uid(), ...fields, exercises: []};
      workouts.push(workout);
      location.hash = `workout=${encodeURIComponent(workout.id)}`;
    }
  } else {
    const duration = Number(form.get('duration')), rest = Number(form.get('rest'));
    if (!Number.isInteger(duration) || duration < 1 || duration > 3600 || !Number.isInteger(rest) || rest < 0 || rest > 3600) { $('#editor-error').textContent = 'Enter whole seconds: work 1–3600; rest 0–3600.'; return; }
    const exercises = activeWorkout().exercises, existing = exercises.find(exercise => exercise.id === editor.id);
    if (existing) Object.assign(existing, {name, duration, rest});
    else {
      if (exercises.length >= 200) { $('#editor-error').textContent = 'Maximum of 200 exercises reached.'; return; }
      exercises.push({id: uid(), name, duration, rest});
    }
    resetSession();
  }
  save(); renderLibrary(); $('#editor-dialog').close();
});
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => $('#editor-dialog').close()));
$('#new-workout').addEventListener('click', () => openEditor('workout'));
$('#edit-workout').addEventListener('click', () => openEditor('workout', selectedId));
$('#add-exercise').addEventListener('click', () => openEditor('exercise'));
$('#back-button').addEventListener('click', () => { location.hash = ''; });
$('#workout-grid').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const workout = workouts.find(item => item.id === button.dataset.id);
  if (button.dataset.action === 'open-workout') location.hash = `workout=${encodeURIComponent(workout.id)}`;
  else if (await confirmAction('Delete workout?', `“${workout.name}” and its exercises will be removed from this device.`)) {
    workouts = workouts.filter(item => item.id !== workout.id);
    if (selectedId === workout.id) { timer = null; selectedId = null; syncWakeLock(); }
    save(); renderLibrary(); $('#new-workout').focus(); toast('Workout deleted.');
  }
});
$('#exercise-list').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'edit-exercise') openEditor('exercise', button.dataset.id);
  else {
    timer.pause(); renderTimer(); syncWakeLock();
    const exercise = activeWorkout().exercises.find(item => item.id === button.dataset.id);
    if (await confirmAction('Delete exercise?', `Remove “${exercise.name}”? This resets the current session.`)) {
      activeWorkout().exercises = activeWorkout().exercises.filter(item => item.id !== exercise.id);
      save(); resetSession(); $('#add-exercise').focus();
    }
  }
});

// Pointer events support mouse, pen and touch using the same drag handle.
// Keep the real list unchanged until drop, so cancellation never mutates data.
let exerciseDrag = null;
function moveExercise(id, destination) {
  const exercises = activeWorkout().exercises;
  const origin = exercises.findIndex(exercise => exercise.id === id);
  if (origin < 0 || destination < 0 || destination >= exercises.length || origin === destination) return;
  const [exercise] = exercises.splice(origin, 1);
  exercises.splice(destination, 0, exercise);
  resetSession();
  save();
  renderLibrary();
  const handle = Array.from(document.querySelectorAll('.drag-handle')).find(button => button.dataset.dragId === id);
  handle?.focus({preventScroll: true});
  $('#announcer').textContent = `${exercise.name} moved to position ${destination + 1} of ${exercises.length}. Session reset.`;
}
function clearDropMarker() {
  document.querySelectorAll('#exercise-list .drop-before, #exercise-list .drop-after').forEach(item => item.classList.remove('drop-before', 'drop-after'));
}
function cancelExerciseDrag() {
  if (!exerciseDrag) return;
  const drag = exerciseDrag;
  exerciseDrag = null;
  cancelAnimationFrame(drag.frame);
  drag.preview?.remove();
  drag.item.classList.remove('is-dragging');
  document.body.classList.remove('exercise-dragging');
  clearDropMarker();
  if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
}
function updateExerciseDrop() {
  const drag = exerciseDrag;
  if (!drag?.started) return;
  drag.preview.style.top = `${drag.y - drag.offsetY}px`;
  clearDropMarker();
  const bounds = $('#exercise-list').getBoundingClientRect();
  drag.destination = null;
  if (drag.x < bounds.left - 24 || drag.x > bounds.right + 24 || drag.y < bounds.top - 56 || drag.y > bounds.bottom + 56) return;
  const others = Array.from($('#exercise-list').children).filter(item => item !== drag.item);
  let index = others.findIndex(item => {
    const rect = item.querySelector('.exercise-row').getBoundingClientRect();
    return drag.y < rect.top + rect.height / 2;
  });
  if (index < 0) index = others.length;
  drag.destination = index;
  if (index < others.length) others[index].classList.add('drop-before');
  else others.at(-1)?.classList.add('drop-after');
}
function scrollExerciseDrag() {
  const drag = exerciseDrag;
  if (!drag?.started) return;
  const bounds = $('#exercise-list').getBoundingClientRect();
  if (drag.x >= bounds.left - 24 && drag.x <= bounds.right + 24) {
    const edge = 70;
    const speed = drag.y < edge ? -Math.min(16, (edge - drag.y) / 4)
      : drag.y > innerHeight - edge ? Math.min(16, (drag.y - innerHeight + edge) / 4) : 0;
    if (speed) window.scrollBy(0, speed);
  }
  updateExerciseDrop();
  drag.frame = requestAnimationFrame(scrollExerciseDrag);
}
$('#exercise-list').addEventListener('pointerdown', event => {
  const handle = event.target.closest('.drag-handle');
  if (!handle || handle.disabled || !event.isPrimary || event.button !== 0 || exerciseDrag) return;
  const item = handle.closest('li');
  const rect = item.getBoundingClientRect();
  exerciseDrag = {handle, item, id: handle.dataset.dragId, pointerId: event.pointerId,
    startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
    offsetY: event.clientY - rect.top, started: false, destination: null, frame: 0};
  handle.setPointerCapture(event.pointerId);
});
$('#exercise-list').addEventListener('pointermove', event => {
  const drag = exerciseDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (!drag.started) {
    if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    drag.started = true;
    timer.pause(); renderTimer(); syncWakeLock();
    const rect = drag.item.getBoundingClientRect();
    drag.preview = drag.item.cloneNode(true);
    drag.preview.classList.add('exercise-drag-preview');
    drag.preview.setAttribute('aria-hidden', 'true');
    drag.preview.inert = true;
    drag.preview.style.left = `${rect.left}px`;
    drag.preview.style.width = `${rect.width}px`;
    document.body.append(drag.preview);
    drag.item.classList.add('is-dragging');
    document.body.classList.add('exercise-dragging');
    $('#announcer').textContent = 'Drag to a new position. Press Escape to cancel.';
    drag.frame = requestAnimationFrame(scrollExerciseDrag);
  }
  event.preventDefault();
  updateExerciseDrop();
});
$('#exercise-list').addEventListener('pointerup', event => {
  const drag = exerciseDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX; drag.y = event.clientY;
  updateExerciseDrop();
  cancelExerciseDrag();
  if (drag.started && drag.destination !== null) moveExercise(drag.id, drag.destination);
});
for (const type of ['pointercancel', 'lostpointercapture']) {
  $('#exercise-list').addEventListener(type, event => {
    if (exerciseDrag?.pointerId === event.pointerId) cancelExerciseDrag();
  });
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && exerciseDrag) {
    cancelExerciseDrag();
    $('#announcer').textContent = 'Reordering cancelled. Exercise order unchanged.';
    event.preventDefault();
  }
});
$('#exercise-list').addEventListener('keydown', event => {
  const handle = event.target.closest('.drag-handle');
  if (!handle || handle.disabled || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  cancelExerciseDrag();
  const exercises = activeWorkout().exercises;
  const index = exercises.findIndex(exercise => exercise.id === handle.dataset.dragId);
  const destination = event.key === 'Home' ? 0 : event.key === 'End' ? exercises.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1);
  moveExercise(handle.dataset.dragId, destination);
});
window.addEventListener('blur', cancelExerciseDrag);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelExerciseDrag(); });

function updatePreferences() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-toggle').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#theme-toggle').title = `Switch to ${dark ? 'light' : 'dark'} mode`;
  $('#theme-toggle').setAttribute('aria-label', $('#theme-toggle').title);
  $('#sound-toggle').innerHTML = icon(soundEnabled ? 'sound' : 'mute');
  $('#sound-toggle').title = `Turn sound ${soundEnabled ? 'off' : 'on'}`;
  $('#sound-toggle').setAttribute('aria-label', $('#sound-toggle').title);
  $('#sound-toggle').setAttribute('aria-pressed', String(soundEnabled));
  $('meta[name="theme-color"]').content = dark ? '#16191e' : '#f7f8fa';
}
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
document.documentElement.dataset.theme = readPreference(THEME_KEY) || (systemTheme.matches ? 'dark' : 'light');
systemTheme.addEventListener('change', event => { if (!readPreference(THEME_KEY)) { document.documentElement.dataset.theme = event.matches ? 'dark' : 'light'; updatePreferences(); } });
$('#theme-toggle').addEventListener('click', () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; writePreference(THEME_KEY, document.documentElement.dataset.theme); updatePreferences(); });
$('#sound-toggle').addEventListener('click', () => { soundEnabled = !soundEnabled; writePreference(SOUND_KEY, soundEnabled ? 'on' : 'off'); updatePreferences(); if (soundEnabled) { unlockAudio(); beep(); } });
function unlockAudio() {
  if (!soundEnabled) return;
  try { const Audio = window.AudioContext || window.webkitAudioContext; if (Audio) { audioContext ||= new Audio(); audioContext.resume().catch(() => {}); } } catch { /* Sound is an optional enhancement. */ }
}
function beep(complete = false) {
  if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
  const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), now = audioContext.currentTime;
  oscillator.connect(gain); gain.connect(audioContext.destination);
  oscillator.frequency.setValueAtTime(complete ? 880 : 660, now);
  gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
  oscillator.start(now); oscillator.stop(now + 0.36);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}
async function syncWakeLock() {
  const needed = () => timer?.state === 'running' && document.visibilityState === 'visible';
  if (!needed()) { if (wakeLock) { const lock = wakeLock; wakeLock = null; await lock.release().catch(() => {}); } return; }
  if (!navigator.wakeLock || wakeLock || requestingWakeLock) return;
  requestingWakeLock = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!needed()) await lock.release();
    else { wakeLock = lock; lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; }); }
  } catch { /* Unsupported or denied wake locks do not prevent timing. */ }
  finally { requestingWakeLock = false; }
}
function tick() {
  if (!timer || timer.state !== 'running') return;
  const previousIndex = timer.index;
  timer.tick();
  if (timer.index !== previousIndex) beep(timer.state === 'complete');
  renderTimer();
  if (timer.state === 'complete') syncWakeLock();
}
$('#play-button').addEventListener('click', () => {
  unlockAudio();
  if (timer.state === 'running') timer.pause(); else timer.start();
  renderTimer(); syncWakeLock();
});
$('#reset-button').addEventListener('click', () => { timer.reset(); renderTimer(); syncWakeLock(); });
$('#skip-button').addEventListener('click', () => { timer.tick(); timer.skip(); renderTimer(); syncWakeLock(); });
document.addEventListener('visibilitychange', () => { tick(); syncWakeLock(); });
window.addEventListener('beforeunload', event => { if (timer?.state === 'running') { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('keydown', event => {
  if (event.code === 'Space' && !$('#workout-view').hidden && !document.querySelector('dialog[open]') && !/INPUT|TEXTAREA|SELECT|BUTTON|A/.test(event.target.tagName)) {
    event.preventDefault(); if (!$('#play-button').disabled) $('#play-button').click();
  }
});
$('#import-button').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const input = event.target;
  const files = Array.from(input.files);
  if (!files.length) return;
  input.disabled = true;
  $('#import-button').disabled = true;
  try {
    const imported = [];
    for (const file of files) {
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('Choose a JSON file no larger than 2 MB.');
        imported.push(...validateData(JSON.parse(await file.text())));
      } catch (error) {
        throw new Error(`“${file.name}”: ${error instanceof SyntaxError ? 'This file isn’t valid JSON.' : error.message}`);
      }
      if (workouts.length + imported.length > 200) throw new Error('Your collection can contain up to 200 workouts. Select fewer workouts or delete some first.');
    }
    if (!imported.length) { toast('The selected files contain no workouts. Your collection is unchanged.'); return; }
    const summary = `${imported.length} workout${imported.length === 1 ? '' : 's'} from ${files.length} JSON file${files.length === 1 ? '' : 's'}`;
    if (!await confirmAction('Add imported workouts?', `Add ${summary}? Your existing workouts will be kept. Importing a workout again adds a separate copy.`, 'Add workouts')) return;
    // Validate as one collection so IDs remain unique across existing workouts
    // and all selected files. Nothing is changed until the whole batch succeeds.
    workouts = validateData({version: 1, workouts: [...workouts, ...imported]});
    fileLoadFailed = false;
    const saved = save();
    renderLibrary();
    if (saved) toast(`Added ${summary}.`);
  } catch (error) { toast(`${error.message} Nothing was imported.`); }
  finally { input.value = ''; input.disabled = false; $('#import-button').disabled = false; }
});
$('#export-button').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({version: 1, workouts}, null, 2) + '\n'], {type: 'application/json'}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'workouts.json'; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function initialize() {
  updatePreferences();
  $('#clock-ticks').innerHTML = Array.from({length: 60}, (_, index) => `<line class="clock-tick" x1="120" y1="${index % 5 ? 28 : 26}" x2="120" y2="${index % 5 ? 31 : 34}" transform="rotate(${index * 6} 120 120)"/>`).join('');
  const stored = readPreference(STORAGE_KEY);
  let loaded = false;
  if (stored !== null) {
    try { workouts = validateData(JSON.parse(stored)); loaded = true; }
    catch { toast('Saved data could not be read. Loading the starter file.'); }
  }
  if (!loaded) {
    try {
      const response = await fetch('./workouts.json', {cache: 'no-store'});
      if (!response.ok) throw new Error('Workout file unavailable');
      workouts = validateData(await response.json());
    } catch {
      fileLoadFailed = true;
      toast('Use Import JSON to load workouts.json, or serve this folder with a local web server.');
    }
  }
  route();
  window.addEventListener('hashchange', route);
  setInterval(tick, 100);
}
initialize();
