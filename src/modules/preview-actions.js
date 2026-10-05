export function previewStatus(message = 'Preview only - nothing was published.') {
  let status = document.getElementById('v2-preview-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'v2-preview-status';
    status.className = 'tw:fixed tw:bottom-6 tw:left-1/2 tw:z-[10000] tw:-translate-x-1/2 tw:rounded-md tw:border tw:border-antique tw:bg-obsidian tw:px-5 tw:py-3 tw:text-sm tw:text-champagne tw:shadow-lg';
    status.setAttribute('role', 'status');
    document.body.appendChild(status);
  }
  status.textContent = message;
}

export function initPreviewActions() {
  for (const form of document.querySelectorAll('form:not([data-live-auth-form])')) form.addEventListener('submit', event => { event.preventDefault(); previewStatus(); });
  for (const button of document.querySelectorAll('[data-preview-action]')) button.addEventListener('click', () => previewStatus());
}