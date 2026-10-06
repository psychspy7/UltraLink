'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export interface PredictiveArcCanvasProps {
  /** Visual variant preset: "void-field" | "data-pixel-arc" | "signal-particles" | "ribbon-field" */
  variant?: 'void-field' | 'data-pixel-arc' | 'signal-particles' | 'ribbon-field' | string;
  /** Primary hue angle (0 to 360, default: 210 for cyan/teal void) */
  hue?: number;
  /** Color saturation multiplier (0.0 to 1.0, default: 0.85) */
  saturation?: number;
  /** Brightness / intensity multiplier (0.0 to 1.0, default: 0.70) */
  brightness?: number;
  /** Color theme mode: "dark" | "light" (default: "dark") */
  mode?: 'dark' | 'light';
  /** Animation speed multiplier (default: 1.0) */
  speed?: number;
  /** Particle / arc density (default: 1.0) */
  density?: number;
  /** Interactive mouse parallax responsiveness (default: true) */
  interactive?: boolean;
  /** Additional CSS class names */
  className?: string;
  /** Inline CSS styles */
  style?: React.CSSProperties;
}

/**
 * ThreeUI PredictiveArcCanvas (variant: "void-field")
 * Standalone procedural WebGL cosmic void with predictive trajectory arcs and vector particles.
 */
export const PredictiveArcCanvas: React.FC<PredictiveArcCanvasProps> = ({
  variant = 'void-field',
  hue = 210,
  saturation = 0.85,
  brightness = 0.7,
  mode = 'dark',
  speed = 1.0,
  density = 1.0,
  interactive = true,
  className = '',
  style = {},
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene, Camera, Renderer initialization
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / Math.max(height, 1), 0.1, 1000);
    camera.position.z = 80;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      // Fallback if WebGL is unavailable
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
    container.appendChild(renderer.domElement);

    // 2. Procedural "void-field" Geometry & Materials
    const particleCount = Math.floor(1200 * density);
    const arcCount = Math.floor(35 * density);

    // Flowing particles
    const particleGeo = new THREE.BufferGeometry();
    const posArray = new Float32Array(particleCount * 3);
    const velocityArray = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      posArray[i] = (Math.random() - 0.5) * 160;
      posArray[i + 1] = (Math.random() - 0.5) * 120;
      posArray[i + 2] = (Math.random() - 0.5) * 100;

      velocityArray[i] = (Math.random() - 0.5) * 0.15;
      velocityArray[i + 1] = (Math.random() - 0.5) * 0.15;
      velocityArray[i + 2] = (Math.random() - 0.5) * 0.15;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

    // Convert Hue/Sat/Lightness to THREE.Color
    const baseColor = new THREE.Color().setHSL(
      hue / 360,
      saturation,
      brightness * (mode === 'dark' ? 0.6 : 0.8)
    );

    const particleMat = new THREE.PointsMaterial({
      size: 1.8,
      color: baseColor,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // Predictive Arcs (Curves representing trajectory vectors)
    const arcGroup = new THREE.Group();
    const arcMaterials: THREE.LineBasicMaterial[] = [];
    const arcGeometries: THREE.BufferGeometry[] = [];

    for (let i = 0; i < arcCount; i++) {
      const radius = 25 + Math.random() * 45;
      const startAngle = Math.random() * Math.PI * 2;
      const arcLength = Math.PI * (0.25 + Math.random() * 0.6);
      const points: THREE.Vector3[] = [];

      for (let j = 0; j <= 40; j++) {
        const theta = startAngle + (j / 40) * arcLength;
        const x = Math.cos(theta) * radius;
        const y = Math.sin(theta) * (radius * 0.6);
        const z = (Math.random() - 0.5) * 15;
        points.push(new THREE.Vector3(x, y, z));
      }

      const curveGeo = new THREE.BufferGeometry().setFromPoints(points);
      arcGeometries.push(curveGeo);

      const curveColor = new THREE.Color().setHSL(
        ((hue + (Math.random() * 30 - 15) + 360) % 360) / 360,
        saturation,
        brightness * 0.55
      );
      const curveMat = new THREE.LineBasicMaterial({
        color: curveColor,
        transparent: true,
        opacity: 0.35 + Math.random() * 0.35,
        blending: THREE.AdditiveBlending,
      });
      arcMaterials.push(curveMat);

      const line = new THREE.Line(curveGeo, curveMat);
      line.rotation.x = Math.random() * Math.PI;
      line.rotation.y = Math.random() * Math.PI;
      arcGroup.add(line);
    }
    scene.add(arcGroup);

    // 3. Pointer interaction
    let mouseX = 0;
    let mouseY = 0;
    const onMouseMove = (e: MouseEvent) => {
      if (!interactive) return;
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      }
    };
    window.addEventListener('mousemove', onMouseMove);

    // 4. Resize Observer
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    // 5. Animation Loop
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      clock.getDelta(); // keep delta advancing

      // Rotate and drift arcs
      arcGroup.rotation.y += 0.0025 * speed;
      arcGroup.rotation.x += 0.0008 * speed;

      // Parallax easing toward mouse
      camera.position.x += (mouseX * 10 - camera.position.x) * 0.03;
      camera.position.y += (mouseY * 10 - camera.position.y) * 0.03;
      camera.lookAt(scene.position);

      // Particle positions update
      const positions = particleGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount * 3; i += 3) {
        positions[i] += velocityArray[i] * speed;
        positions[i + 1] += velocityArray[i + 1] * speed;
        positions[i + 2] += velocityArray[i + 2] * speed;

        // Wrap around bounds
        if (Math.abs(positions[i]) > 80) positions[i] *= -0.95;
        if (Math.abs(positions[i + 1]) > 60) positions[i + 1] *= -0.95;
        if (Math.abs(positions[i + 2]) > 50) positions[i + 2] *= -0.95;
      }
      particleGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    };

    animate();

    // 6. Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', onMouseMove);
      resizeObserver.disconnect();
      particleGeo.dispose();
      particleMat.dispose();
      arcGeometries.forEach((g) => g.dispose());
      arcMaterials.forEach((m) => m.dispose());
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [variant, hue, saturation, brightness, mode, speed, density, interactive]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full relative overflow-hidden pointer-events-none ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
};

export default PredictiveArcCanvas;
