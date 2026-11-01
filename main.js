document.querySelector('.lead-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const status = form.querySelector('.form-status');
  button.disabled = true;
  status.className = 'form-status';
  status.textContent = window.baiagentI18n.t('Отправляем заявку…');
  try {
    const response = await fetch(form.action, { method: 'POST', body: new FormData(form) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Ошибка отправки');
    status.classList.add('is-success');
    status.textContent = window.baiagentI18n.t('Заявка отправлена. Мы свяжемся с вами, чтобы обсудить поддержку советника.');
    form.reset();
  } catch (error) {
    status.classList.add('is-error');
    status.textContent = window.baiagentI18n.t('Не получилось отправить заявку. Проверьте соединение и попробуйте ещё раз.');
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('.faq details').forEach((detail) => {
  detail.addEventListener('toggle', () => {
    if (!detail.open) return;
    document.querySelectorAll('.faq details[open]').forEach((other) => {
      if (other !== detail) other.open = false;
    });
  });
});
