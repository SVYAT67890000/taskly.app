let profileUser = null;
let selectedAvatar = null;
let cropperInstance = null;
let cropperModal = null;
let deleteAccountModal = null;
let pendingDeleteCredentials = null;
const emojiOptions = ['😀','😎','😊','🤩','🥳','😺','🐱','🐶','🐼','🦊','🐨','🐯','🐸','🦄','🌈','🌟','⚡️','🔥','🎯','🚀'];

document.addEventListener('DOMContentLoaded', () => {
  profileUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!profileUser) return;
  
  selectedAvatar = profileUser.avatar || { type: 'emoji', value: '👤' };
  cropperModal = document.getElementById('avatarCropModal') ? new bootstrap.Modal(document.getElementById('avatarCropModal')) : null;
  
  initAvatarSection();
  populateProfileForm();
  setupProfileForm();
  setupPasswordForm();
  setupDeleteAccountForm();
  updateStatusBadge();
  renderProfileIds();
  loadAchievements();
  setupCopyButtons();
});

function renderProfileIds() {
  const tagEl = document.getElementById('profileTag');
  const publicEl = document.getElementById('profilePublicId');
  if (tagEl) tagEl.textContent = profileUser.tag || `${profileUser.username}#${profileUser.discriminator || '????'}`;
  if (publicEl) publicEl.textContent = profileUser.publicId || '—';
}

function setupCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-copy');
      const el = document.getElementById(id);
      if (!el) return;
      navigator.clipboard.writeText(el.textContent).then(() => {
        showNotification?.('Скопировано', { type: 'success' });
      });
    });
  });
}

async function loadAchievements() {
  const grid = document.getElementById('achievementsGrid');
  if (!grid) return;
  try {
    const { achievements } = await TasklyApi.getAchievements();
    grid.innerHTML = achievements.map(a => `
      <div class="achievement-card ${a.unlocked ? 'unlocked' : 'locked'}">
        <span class="achievement-icon"><ion-icon name="${getAchievementIcon(a.id)}"></ion-icon></span>
        <div class="achievement-info">
          <strong>${a.title}</strong>
          <p>${a.description}</p>
          ${a.unlocked ? `<small>${new Date(a.unlockedAt).toLocaleDateString('ru-RU')}</small>` : '<small>Заблокировано</small>'}
        </div>
      </div>
    `).join('');
  } catch (_) {
    const cached = localStorage.getItem('achievements');
    if (cached) {
      const achievements = JSON.parse(cached);
      grid.innerHTML = achievements.map(a => `
        <div class="achievement-card ${a.unlocked ? 'unlocked' : 'locked'}">
          <span class="achievement-icon"><ion-icon name="${getAchievementIcon(a.id)}"></ion-icon></span>
          <div class="achievement-info"><strong>${a.title}</strong><p>${a.description}</p></div>
        </div>
      `).join('');
    }
  }
}

function initAvatarSection() {
  updateAvatarPreview(selectedAvatar);
  renderEmojiPicker();
  
  const toggleEmojiPickerBtn = document.getElementById('toggleEmojiPickerBtn');
  const emojiPicker = document.getElementById('emojiPicker');
  if (toggleEmojiPickerBtn && emojiPicker) {
    toggleEmojiPickerBtn.addEventListener('click', () => {
      emojiPicker.classList.toggle('open');
    });
  }
  
  const fileInput = document.getElementById('avatarFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', handleAvatarFileChange);
  }
  
  const applyCropBtn = document.getElementById('applyAvatarCropBtn');
  if (applyCropBtn) {
    applyCropBtn.addEventListener('click', applyAvatarCrop);
  }
  
  const saveAvatarBtn = document.getElementById('saveAvatarBtn');
  if (saveAvatarBtn) {
    saveAvatarBtn.addEventListener('click', saveAvatar);
  }
}

function updateAvatarPreview(avatar) {
  const previewEl = document.getElementById('profileAvatarPreview');
  if (!previewEl) return;
  
  if (avatar?.type === 'image' && avatar.value) {
    previewEl.classList.add('has-image');
    previewEl.textContent = '';
    previewEl.style.backgroundImage = `url(${avatar.value})`;
    previewEl.style.backgroundSize = 'cover';
    previewEl.style.backgroundPosition = 'center';
  } else {
    previewEl.classList.remove('has-image');
    previewEl.style.backgroundImage = '';
    previewEl.textContent = avatar?.value || '👤';
  }
}

function renderEmojiPicker() {
  const emojiPicker = document.getElementById('emojiPicker');
  if (!emojiPicker) return;
  
  emojiPicker.innerHTML = '';
  emojiOptions.forEach(emoji => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-option';
    button.textContent = emoji;
    button.addEventListener('click', () => {
      selectedAvatar = { type: 'emoji', value: emoji };
      updateAvatarPreview(selectedAvatar);
    });
    emojiPicker.appendChild(button);
  });
}

function handleAvatarFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const imageEl = document.getElementById('avatarCropImage');
    if (!imageEl) return;
    imageEl.src = e.target.result;
    
    if (cropperInstance) {
      cropperInstance.destroy();
    }
    
    setTimeout(() => {
      cropperInstance = new Cropper(imageEl, {
        aspectRatio: 1,
        viewMode: 1,
        autoCropArea: 0.95,
        responsive: true,
        background: false
      });
    }, 100);
    
    cropperModal?.show();
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function applyAvatarCrop() {
  if (!cropperInstance) return;
  const canvas = cropperInstance.getCroppedCanvas({ width: 512, height: 512 });
  const dataUrl = canvas.toDataURL('image/png');
  selectedAvatar = { type: 'image', value: dataUrl };
  updateAvatarPreview(selectedAvatar);
  cropperModal?.hide();
  cropperInstance.destroy();
  cropperInstance = null;
}

function saveAvatar() {
  if (!selectedAvatar) {
    showNotification?.('Выберите аватар прежде чем сохранять');
    return;
  }
  const updated = updateCurrentUserData({ avatar: selectedAvatar });
  if (updated) {
    profileUser = updated;
    showNotification?.('Аватар обновлён!');
  } else {
    alert('Не удалось сохранить аватар.');
  }
}

function populateProfileForm() {
  const nameInput = document.getElementById('profileName');
  const statusInput = document.getElementById('profileStatus');
  const phoneInput = document.getElementById('profilePhone');
  const emailInput = document.getElementById('profileEmail');
  const bioInput = document.getElementById('profileBio');
  
  if (nameInput) nameInput.value = profileUser.username || '';
  if (statusInput) statusInput.value = profileUser.status || '';
  if (phoneInput) phoneInput.value = profileUser.phone || '';
  if (emailInput) emailInput.value = profileUser.email || '';
  if (bioInput) bioInput.value = profileUser.bio || '';
  
  const resetBtn = document.getElementById('resetProfileForm');
  if (resetBtn) {
    resetBtn.addEventListener('click', populateProfileForm);
  }
}

function setupProfileForm() {
  const form = document.getElementById('profileForm');
  if (!form) return;
  
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const updates = {
      username: document.getElementById('profileName')?.value.trim(),
      status: document.getElementById('profileStatus')?.value.trim(),
      phone: document.getElementById('profilePhone')?.value.trim(),
      bio: document.getElementById('profileBio')?.value.trim()
    };
    
    const updated = updateCurrentUserData(updates);
    if (updated) {
      profileUser = updated;
      updateStatusBadge();
      showNotification?.('Профиль сохранён!');
    } else {
      alert('Не удалось сохранить профиль.');
    }
  });
}

function setupPasswordForm() {
  const sendCodeBtn = document.getElementById('sendCodeBtn');
  if (sendCodeBtn) {
    sendCodeBtn.addEventListener('click', async () => {
      sendCodeBtn.disabled = true;
      try {
        const data = await TasklyApi.requestPasswordCode();
        showNotification?.(data.message || 'Код отправлен на ваш email', { type: 'success' });
      } catch (e) {
        showAppError?.('Ошибка', e.message || 'Не удалось отправить код');
      } finally {
        sendCodeBtn.disabled = false;
      }
    });
  }
  
  const passwordForm = document.getElementById('passwordForm');
  if (!passwordForm) return;
  
  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('passwordCode')?.value.trim();
    const newPassword = document.getElementById('newPassword')?.value;
    const confirmPassword = document.getElementById('confirmPassword')?.value;
    
    if (!code) {
      showAppError?.('Код не введён', 'Введите код из письма.');
      return;
    }
    const pwdErr = validatePassword?.(newPassword);
    if (pwdErr) {
      showAppError?.('Пароль', pwdErr);
      return;
    }
    if (newPassword !== confirmPassword) {
      showAppError?.('Пароли не совпадают', 'Повторите пароль так же, как в первом поле.');
      return;
    }
    
    const success = await updateUserPassword(code, newPassword);
    if (success) {
      passwordForm.reset();
      showNotification?.('Пароль обновлён!', { type: 'success' });
    }
  });
}

function setupDeleteAccountForm() {
  const form = document.getElementById('deleteAccountForm');
  const modalEl = document.getElementById('deleteAccountModal');
  if (!form || !modalEl) return;

  deleteAccountModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  const emailInput = document.getElementById('deleteAccountEmail');
  if (emailInput && profileUser?.email) {
    emailInput.value = profileUser.email;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('deleteAccountEmail')?.value.trim();
    const password = document.getElementById('deleteAccountPassword')?.value;

    if (!email || !validateEmail?.(email)) {
      showAppError?.('Email', 'Введите корректный email аккаунта.');
      return;
    }
    if (email.toLowerCase() !== String(profileUser?.email || '').toLowerCase()) {
      showAppError?.('Email', 'Email не совпадает с вашим аккаунтом.');
      return;
    }
    const pwdErr = validatePassword?.(password);
    if (pwdErr) {
      showAppError?.('Пароль', pwdErr);
      return;
    }

    pendingDeleteCredentials = { email, password };
    deleteAccountModal.show();
  });

  document.getElementById('confirmDeleteAccountBtn')?.addEventListener('click', async () => {
    if (!pendingDeleteCredentials) return;
    const btn = document.getElementById('confirmDeleteAccountBtn');
    if (btn) btn.disabled = true;

    try {
      await TasklyApi.deleteAccount(pendingDeleteCredentials.email, pendingDeleteCredentials.password);
      deleteAccountModal.hide();
      localStorage.removeItem('userToken');
      localStorage.removeItem('currentUser');
      sessionStorage.removeItem('userToken');
      sessionStorage.removeItem('currentUser');
      window.location.href = 'login.html';
    } catch (e) {
      showAppError?.('Не удалось удалить аккаунт', e.message || 'Проверьте email и пароль.');
    } finally {
      if (btn) btn.disabled = false;
      pendingDeleteCredentials = null;
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => {
    pendingDeleteCredentials = null;
  });
}

function updateStatusBadge() {
  const statusTextEl = document.getElementById('profileStatusText');
  if (statusTextEl) {
    statusTextEl.textContent = profileUser.status?.length ? profileUser.status : 'В сети';
  }
}

