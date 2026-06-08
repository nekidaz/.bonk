const shots = {
  http: {
    src: 'screenshots/http.jpg',
    alt: 'HTTP request editor with query params',
    caption: 'HTTP requests with query params, tabs, file-backed collections, and a response pane.'
  },
  grpc: {
    src: 'screenshots/grpc.jpg',
    alt: 'gRPC request editor with response output',
    caption: 'gRPC calls with server reflection, example JSON messages, metadata, and formatted responses.'
  },
  overview: {
    src: 'screenshots/overview.jpg',
    alt: 'bonk workspace overview with collections and Git status',
    caption: 'Collections are folders on disk, so the sidebar can show Git status directly beside each request.'
  }
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const image = document.querySelector('#gallery-image');
const caption = document.querySelector('#gallery-caption');

document.querySelectorAll('.gallery-tab').forEach((button) => {
  button.addEventListener('click', () => {
    const shot = shots[button.dataset.shot];
    if (!shot || !image || !caption) return;

    document.querySelectorAll('.gallery-tab').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    image.classList.add('is-swapping');
    window.setTimeout(
      () => {
        image.src = shot.src;
        image.alt = shot.alt;
        caption.textContent = shot.caption;
        image.classList.remove('is-swapping');
      },
      reduceMotion ? 0 : 110
    );
  });
});

document.querySelectorAll('.copy-command').forEach((button) => {
  button.addEventListener('click', async () => {
    const command = button.dataset.copy;
    if (!command) return;

    try {
      await navigator.clipboard.writeText(command);
      const original = button.innerHTML;
      button.innerHTML = '<code>Copied</code>';
      window.setTimeout(() => {
        button.innerHTML = original;
      }, 1100);
    } catch {
      // Clipboard access may be blocked on file:// previews. The command is still visible.
    }
  });
});

document.querySelectorAll('.section, .quick-stats').forEach((section) => {
  section.classList.add('reveal');
});

if ('IntersectionObserver' in window && !reduceMotion) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.16 }
  );

  document.querySelectorAll('.reveal').forEach((section) => observer.observe(section));
} else {
  document.querySelectorAll('.reveal').forEach((section) => section.classList.add('is-visible'));
}

const canvas = document.querySelector('#hero-scene');

if (canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });

  if (ctx) {
    const pointer = { x: 0.66, y: 0.42 };
    const state = {
      dpr: 1,
      height: 0,
      width: 0
    };

    const lanes = [
      { color: '#20e0a1', offset: 0, y: 0.28 },
      { color: '#1689ff', offset: 0.26, y: 0.43 },
      { color: '#ffb166', offset: 0.52, y: 0.58 },
      { color: '#ff6f8a', offset: 0.78, y: 0.72 }
    ];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.width = Math.max(1, Math.floor(rect.width));
      state.height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(state.width * state.dpr);
      canvas.height = Math.floor(state.height * state.dpr);
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    };

    const drawDotMatrix = (time) => {
      const gap = 22;
      const drift = (time * 0.006) % gap;

      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.055)';
      for (let x = -gap + drift; x < state.width + gap; x += gap) {
        for (let y = 0; y < state.height; y += gap) {
          const leftFade = Math.max(0.15, x / state.width);
          ctx.globalAlpha = 0.32 * leftFade;
          ctx.fillRect(x, y, 1, 1);
        }
      }
      ctx.restore();
    };

    const drawRoutes = (time) => {
      const startX = state.width * 0.52 + (pointer.x - 0.5) * 16;
      const endX = state.width * 0.94;

      lanes.forEach((lane, index) => {
        const y = state.height * lane.y + (pointer.y - 0.5) * (index + 1) * 4;
        const wave = Math.sin(time * 0.0009 + index) * 18;

        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = lane.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.bezierCurveTo(startX + 110, y + wave, endX - 180, y - wave, endX, y + wave * 0.2);
        ctx.stroke();

        const progress = (time * 0.00022 + lane.offset) % 1;
        const x = startX + (endX - startX) * progress;
        const pulseY = y + Math.sin(progress * Math.PI * 2 + index) * 12;
        const gradient = ctx.createRadialGradient(x, pulseY, 0, x, pulseY, 34);
        gradient.addColorStop(0, lane.color);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 0.36;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, pulseY, 34, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.88;
        ctx.fillStyle = lane.color;
        ctx.beginPath();
        ctx.arc(x, pulseY, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    };

    const draw = (time = 0) => {
      ctx.clearRect(0, 0, state.width, state.height);
      ctx.fillStyle = '#08090d';
      ctx.fillRect(0, 0, state.width, state.height);
      drawDotMatrix(time);
      drawRoutes(time);

      if (!reduceMotion) window.requestAnimationFrame(draw);
    };

    window.addEventListener('resize', () => {
      resize();
      if (reduceMotion) draw(0);
    });

    window.addEventListener(
      'pointermove',
      (event) => {
        const rect = canvas.getBoundingClientRect();
        pointer.x = (event.clientX - rect.left) / rect.width;
        pointer.y = (event.clientY - rect.top) / rect.height;
      },
      { passive: true }
    );

    resize();
    draw(0);
  }
}

/* Cursor interactivity: a soft glow that trails the pointer, a snappier ring,
   and a subtle 3D tilt on cards. Skipped for reduced-motion / touch / coarse
   pointers so it never gets in the way. */
const finePointer = window.matchMedia('(pointer: fine)').matches;

if (!reduceMotion && finePointer) {
  const glow = document.createElement('div');
  glow.className = 'cursor-glow';
  const ring = document.createElement('div');
  ring.className = 'cursor-ring';
  document.body.append(glow, ring);

  let tx = window.innerWidth * 0.5;
  let ty = window.innerHeight * 0.4;
  let gx = tx;
  let gy = ty;
  let rx = tx;
  let ry = ty;
  let seen = false;

  window.addEventListener(
    'pointermove',
    (event) => {
      tx = event.clientX;
      ty = event.clientY;
      if (!seen) {
        seen = true;
        gx = rx = tx;
        gy = ry = ty;
        document.body.classList.add('cursor-on');
      }
    },
    { passive: true }
  );

  window.addEventListener('pointerdown', () => ring.classList.add('is-down'));
  window.addEventListener('pointerup', () => ring.classList.remove('is-down'));

  const follow = () => {
    gx += (tx - gx) * 0.08;
    gy += (ty - gy) * 0.08;
    rx += (tx - rx) * 0.22;
    ry += (ty - ry) * 0.22;
    glow.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    window.requestAnimationFrame(follow);
  };
  window.requestAnimationFrame(follow);

  // Magnetic 3D tilt on the interactive cards.
  document.querySelectorAll('.feature-card, .install-card, .perf-stat').forEach((el) => {
    el.classList.add('tiltable');
    el.addEventListener('pointermove', (event) => {
      const rect = el.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      el.style.transform = `perspective(720px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 6).toFixed(2)}deg) translateY(-3px)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transform = '';
    });
  });
}
