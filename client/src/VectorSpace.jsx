import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function VectorSpace({ isProcessing, isThinking, triggerSearch, isDark }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    
    // 🎥 CAMERA FIX: Field of View (FOV) aur Position badli taaki center alignment perfect ho
    const camera = new THREE.PerspectiveCamera(45, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);
    camera.position.set(0, 5, 95); // Camera ko thoda neeche (Y=5) aur paas (Z=95) laaye hain

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.innerHTML = ""; 
    containerRef.current.appendChild(renderer.domElement);

    // 🎨 Theme Colors
    const particleColor = isDark ? new THREE.Color("#22d3ee") : new THREE.Color("#0891b2"); 
    const lineColor = isDark ? new THREE.Color("#c084fc") : new THREE.Color("#7c3aed");     

    // 2. Vector Particles
    const particleCount = 350;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      // Radius ko thoda kam kiya (18-32) taaki particles container se bahaar na bhaagein
      const r = 18 + Math.random() * 14; 

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      colors[i * 3] = particleColor.r;
      colors[i * 3 + 1] = particleColor.g;
      colors[i * 3 + 2] = particleColor.b;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 1.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
    });

    const points = new THREE.Points(geometry, material);
    
    // 📍 POSITION CORRECTION: Pure points ke globe ko halka sa Y-axis par UPAR push kiya
    points.position.y = -2; 
    scene.add(points);

    // 3. Search Lines Beam
    const lineMaterial = new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0 });
    const beamLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);
    beamLines.position.y = -2; // Lines ko bhi same offset diya
    scene.add(beamLines);

    // 4. Animation Frame
    let clock = new THREE.Clock();

    const animate = () => {
      requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      points.rotation.y = elapsedTime * 0.04;
      points.rotation.x = elapsedTime * 0.02;
      beamLines.rotation.y = elapsedTime * 0.04;
      beamLines.rotation.x = elapsedTime * 0.02;

      if (isProcessing) {
        points.rotation.y = elapsedTime * 0.9;
        beamLines.rotation.y = elapsedTime * 0.9;
        material.size = 2.0 + Math.sin(elapsedTime * 6) * 0.3;
      } else if (isThinking || triggerSearch) {
        material.size = 1.6;
        lineMaterial.opacity = 0.75;
        
        const posArr = points.geometry.attributes.position.array;
        const dynamicLines = [];
        for(let i = 0; i < 3; i++) {
            const idx = Math.floor(Math.random() * particleCount) * 3;
            dynamicLines.push(new THREE.Vector3(0, 0, 0));
            dynamicLines.push(new THREE.Vector3(posArr[idx], posArr[idx+1], posArr[idx+2]));
        }
        beamLines.geometry.setFromPoints(dynamicLines);
      } else {
        material.size = 1.5;
        lineMaterial.opacity = THREE.MathUtils.lerp(lineMaterial.opacity, 0, 0.1);
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [isProcessing, isThinking, triggerSearch, isDark]);

  return (
    <div className={`relative w-full h-[180px] rounded-2xl border transition-colors duration-300 overflow-hidden backdrop-blur-md flex flex-col justify-end ${
      isDark ? "bg-slate-950/50 border-slate-800" : "bg-slate-100/60 border-slate-200"
    }`}>
      
      {/* 📍 Top Badge */}
      <div className="absolute top-3 left-4 z-10 flex items-center gap-1.5 pointer-events-none">
        <span className={`h-2 w-2 rounded-full ${isProcessing ? "bg-amber-400 animate-ping" : "bg-cyan-500 animate-pulse"}`} />
        <span className={`text-[10px] font-mono tracking-wider uppercase font-bold ${isDark ? "text-cyan-400/80" : "text-cyan-700"}`}>
          {isProcessing ? "Ingestion Vortex Active" : isThinking ? "Vector Querying..." : "Vector Space Engine"}
        </span>
      </div>

      {/* 📍 Canvas Box - Flex grow aur perfect layout sizing */}
      <div 
        ref={containerRef} 
        className="w-full h-full block flex items-center justify-center overflow-hidden" 
      />
      
    </div>
  );
}