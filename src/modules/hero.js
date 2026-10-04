export function initHero() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const particles = Array.from({ length: 45 }, () => ({ x: Math.random(), y: Math.random(), size: Math.random() * 2 + 0.6, speed: Math.random() * 0.0004 + 0.0001 }));
  const resize = () => { canvas.width = canvas.parentElement.clientWidth; canvas.height = canvas.parentElement.clientHeight; };
  resize();
  window.addEventListener('resize', resize);
  const animate = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#d8c290';
    for (const particle of particles) {
      particle.y -= particle.speed;
      if (particle.y < 0) particle.y = 1;
      context.globalAlpha = 0.35;
      context.beginPath();
      context.arc(particle.x * canvas.width, particle.y * canvas.height, particle.size, 0, Math.PI * 2);
      context.fill();
    }
    requestAnimationFrame(animate);
  };
  animate();
}