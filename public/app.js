(() => {
  const state = {
    messages: safeParse(localStorage.getItem('gymai.chatHistory'), []),
    currentRoutine: safeParse(localStorage.getItem('gymai.currentRoutine'), null),
    pendingImage: null, // { base64, mediaType, previewUrl }
    loading: false,
    activeTab: 'chat',
  };

  const messagesEl = document.getElementById('messages');
  const formEl = document.getElementById('chat-form');
  const textInput = document.getElementById('text-input');
  const imageInput = document.getElementById('image-input');
  const previewWrap = document.getElementById('image-preview-wrap');
  const previewImg = document.getElementById('image-preview');
  const removeImageBtn = document.getElementById('remove-image');
  const sendBtn = document.getElementById('send-btn');
  const currentRoutineEl = document.getElementById('current-routine');
  const saveRoutineBtn = document.getElementById('save-routine-btn');
  const savedRoutinesEl = document.getElementById('saved-routines');
  const tabButtons = document.querySelectorAll('.tab-btn');
  const views = { chat: document.getElementById('view-chat'), routine: document.getElementById('view-routine') };
  const routineBadge = document.getElementById('routine-badge');

  function safeParse(json, fallback) {
    try {
      const parsed = JSON.parse(json);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function persist() {
    localStorage.setItem('gymai.chatHistory', JSON.stringify(state.messages));
    localStorage.setItem('gymai.currentRoutine', JSON.stringify(state.currentRoutine));
  }

  function getSavedRoutines() {
    return safeParse(localStorage.getItem('gymai.savedRoutines'), []);
  }

  function setSavedRoutines(list) {
    localStorage.setItem('gymai.savedRoutines', JSON.stringify(list));
  }

  // ---------- Pestañas ----------

  function switchTab(tab) {
    state.activeTab = tab;
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    Object.entries(views).forEach(([name, el]) => el.classList.toggle('hidden', name !== tab));
    if (tab === 'routine') {
      routineBadge.classList.add('hidden');
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ---------- Imagen ----------

  async function resizeImageFile(file, maxDim = 1024) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });

    let { width, height } = img;
    if (Math.max(width, height) > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', 0.85);
  }

  imageInput.addEventListener('change', async () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) return;
    const dataUrl = await resizeImageFile(file);
    state.pendingImage = {
      base64: dataUrl.split(',')[1],
      mediaType: 'image/jpeg',
      previewUrl: dataUrl,
    };
    previewImg.src = dataUrl;
    previewWrap.classList.remove('hidden');
    imageInput.value = '';
  });

  removeImageBtn.addEventListener('click', () => {
    state.pendingImage = null;
    previewWrap.classList.add('hidden');
    previewImg.src = '';
  });

  // ---------- Envío de mensajes ----------

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text && !state.pendingImage) return;
    await sendMessage(text);
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 140) + 'px';
  });

  async function sendMessage(text) {
    const content = [];
    if (state.pendingImage) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: state.pendingImage.mediaType,
          data: state.pendingImage.base64,
        },
      });
    }
    if (text) content.push({ type: 'text', text });

    state.messages.push({ role: 'user', content });
    persist();
    renderMessages();

    textInput.value = '';
    textInput.style.height = 'auto';
    state.pendingImage = null;
    previewWrap.classList.add('hidden');
    previewImg.src = '';

    setLoading(true);
    showTypingIndicator();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: state.messages,
          currentRoutine: state.currentRoutine,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `Error ${res.status}`);
      }

      const data = await res.json();
      state.messages.push({ role: 'assistant', content: data.text || '' });
      if (data.routine) {
        state.currentRoutine = data.routine;
        renderRoutine(state.currentRoutine);
        if (state.activeTab !== 'routine') routineBadge.classList.remove('hidden');
      }
      persist();
      hideTypingIndicator();
      renderMessages();
    } catch (err) {
      hideTypingIndicator();
      renderSystemNote(`Error al hablar con la IA: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    sendBtn.disabled = isLoading;
    sendBtn.textContent = isLoading ? 'Pensando…' : 'Enviar';
  }

  function showTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'msg assistant typing';
    div.id = 'typing-indicator';
    div.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTypingIndicator() {
    document.getElementById('typing-indicator')?.remove();
  }

  // ---------- Render de mensajes ----------

  function renderMessages() {
    messagesEl.innerHTML = '';
    for (const message of state.messages) {
      const div = document.createElement('div');
      div.className = `msg ${message.role}`;

      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'text') {
            div.appendChild(document.createTextNode(block.text));
          } else if (block.type === 'image' && block.source && block.source.data) {
            const img = document.createElement('img');
            img.className = 'attached';
            img.src = `data:${block.source.media_type};base64,${block.source.data}`;
            div.appendChild(img);
          }
        }
      } else {
        div.textContent = message.content;
      }

      messagesEl.appendChild(div);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderSystemNote(text) {
    const div = document.createElement('div');
    div.className = 'msg system-note';
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------- Rutina actual ----------

  function renderRoutine(routine) {
    currentRoutineEl.innerHTML = '';
    saveRoutineBtn.disabled = !routine;

    if (!routine) {
      currentRoutineEl.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🗓️</span>
          <p>Aún no hay ninguna rutina.</p>
          <p class="empty-hint">Ve a la pestaña Chat y pide una.</p>
        </div>`;
      return;
    }

    const name = document.createElement('p');
    name.className = 'routine-name';
    name.textContent = routine.routine_name || 'Rutina';
    currentRoutineEl.appendChild(name);

    if (routine.notes) {
      const notes = document.createElement('p');
      notes.className = 'routine-notes';
      notes.textContent = routine.notes;
      currentRoutineEl.appendChild(notes);
    }

    for (const day of routine.days || []) {
      const dayBlock = document.createElement('div');
      dayBlock.className = 'day-block';

      const h3 = document.createElement('h3');
      h3.textContent = day.day_label || 'Día';
      dayBlock.appendChild(h3);

      const steps = document.createElement('div');
      steps.className = 'exercise-steps';
      const dayExercises = day.exercises || [];
      dayExercises.forEach((exercise, index) => {
        steps.appendChild(buildExerciseStep(exercise, index, dayExercises.length));
      });
      dayBlock.appendChild(steps);

      currentRoutineEl.appendChild(dayBlock);
    }
  }

  // Cada ejercicio se muestra como un paso numerado (1, 2, 3...) para dejar
  // claro el ORDEN en que hay que entrenarlos, no como tarjetas sueltas.
  function buildExerciseStep(exercise, index, total) {
    const step = document.createElement('div');
    step.className = 'exercise-step';

    const marker = document.createElement('div');
    marker.className = 'step-marker';

    const number = document.createElement('div');
    number.className = 'step-number';
    number.textContent = String(index + 1);
    marker.appendChild(number);

    if (index < total - 1) {
      const line = document.createElement('div');
      line.className = 'step-line';
      marker.appendChild(line);
    }

    step.appendChild(marker);
    step.appendChild(buildExerciseCard(exercise));
    return step;
  }

  function buildExerciseCard(exercise) {
    const card = document.createElement('div');
    card.className = 'exercise-card';

    const img = document.createElement('img');
    img.className = 'thumb';
    // Preferimos el GIF animado; si falla, caemos a la imagen fija real.
    img.src = exercise.gif_url || exercise.image || '';
    img.alt = exercise.name || '';
    img.loading = 'lazy';
    img.onerror = () => {
      if (exercise.image && img.src !== new URL(exercise.image, window.location.href).href) {
        img.src = exercise.image;
      } else {
        img.style.visibility = 'hidden';
      }
    };
    card.appendChild(img);

    const info = document.createElement('div');
    info.className = 'info';

    const strong = document.createElement('strong');
    strong.textContent = exercise.name || 'Ejercicio';
    info.appendChild(strong);

    const statRow = document.createElement('div');
    statRow.className = 'stat-row';

    if (exercise.sets && exercise.reps) {
      const stat = document.createElement('span');
      stat.className = 'badge stat';
      stat.textContent = `${exercise.sets}×${exercise.reps}`;
      statRow.appendChild(stat);
    }
    if (exercise.muscle_group) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = exercise.muscle_group;
      statRow.appendChild(badge);
    }
    if (exercise.equipment) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = exercise.equipment;
      statRow.appendChild(badge);
    }

    info.appendChild(statRow);
    card.appendChild(info);
    return card;
  }

  // ---------- Guardar / exportar rutinas ----------

  saveRoutineBtn.addEventListener('click', () => {
    if (!state.currentRoutine) return;
    const saved = getSavedRoutines();
    saved.push({
      id: cryptoRandomId(),
      savedAt: new Date().toISOString(),
      routine: state.currentRoutine,
    });
    setSavedRoutines(saved);
    renderSavedRoutines();
  });

  function cryptoRandomId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now();
  }

  function exportRoutine(routine, filename) {
    const blob = new Blob([JSON.stringify(routine, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderSavedRoutines() {
    const saved = getSavedRoutines();
    savedRoutinesEl.innerHTML = '';

    if (saved.length === 0) {
      savedRoutinesEl.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">💾</span>
          <p>No has guardado ninguna rutina todavía.</p>
        </div>`;
      return;
    }

    for (const entry of saved.slice().reverse()) {
      const item = document.createElement('div');
      item.className = 'saved-item';

      const label = document.createElement('div');
      label.className = 'saved-item-label';
      const date = new Date(entry.savedAt);
      const strong = document.createElement('strong');
      strong.textContent = entry.routine.routine_name || 'Rutina';
      const span = document.createElement('span');
      span.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString().slice(0, 5);
      label.appendChild(strong);
      label.appendChild(span);
      item.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'saved-item-actions';

      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'Cargar';
      loadBtn.addEventListener('click', () => {
        state.currentRoutine = entry.routine;
        persist();
        renderRoutine(state.currentRoutine);
      });
      actions.appendChild(loadBtn);

      const exportBtn = document.createElement('button');
      exportBtn.textContent = 'Exportar';
      exportBtn.addEventListener('click', () => {
        exportRoutine(entry.routine, `${(entry.routine.routine_name || 'rutina').replace(/\s+/g, '-')}.json`);
      });
      actions.appendChild(exportBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger';
      deleteBtn.textContent = 'Borrar';
      deleteBtn.addEventListener('click', () => {
        const remaining = getSavedRoutines().filter((r) => r.id !== entry.id);
        setSavedRoutines(remaining);
        renderSavedRoutines();
      });
      actions.appendChild(deleteBtn);

      item.appendChild(actions);
      savedRoutinesEl.appendChild(item);
    }
  }

  // ---------- Init ----------

  switchTab('chat');
  renderMessages();
  renderRoutine(state.currentRoutine);
  renderSavedRoutines();
})();
