let profileUser = null;
let selectedAvatar = null;
let cropperInstance = null;
let cropperModal = null;
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
  updateStatusBadge();
});

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
        viewMode: 2,
        autoCropArea: 1,
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
    sendCodeBtn.addEventListener('click', () => {
      const code = requestPasswordCode();
      if (code) {
        showNotification?.(`Код подтверждения отправлен на email. (Демо: ${code})`);
      } else {
        alert('Не удалось отправить код');
      }
    });
  }
  
  const passwordForm = document.getElementById('passwordForm');
  if (!passwordForm) return;
  
  passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = document.getElementById('passwordCode')?.value.trim();
    const newPassword = document.getElementById('newPassword')?.value;
    const confirmPassword = document.getElementById('confirmPassword')?.value;
    
    if (!code || !verifyPasswordCode(code)) {
      showNotification?.('Неверный или просроченный код.', { type: 'warning' });
      return;
    }
    
    if (!newPassword || newPassword.length < 6) {
      showNotification?.('Пароль должен содержать минимум 6 символов.', { type: 'warning' });
      return;
    }
    
    if (newPassword !== confirmPassword) {
      showNotification?.('Пароли не совпадают.', { type: 'warning' });
      return;
    }
    
    const success = updateUserPassword(newPassword);
    if (success) {
      passwordForm.reset();
      showNotification?.('Пароль обновлён!');
    } else {
      alert('Не удалось изменить пароль');
    }
  });
}

function updateStatusBadge() {
  const statusTextEl = document.getElementById('profileStatusText');
  if (statusTextEl) {
    statusTextEl.textContent = profileUser.status?.length ? profileUser.status : 'В сети';
  }
}

