import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { HookScene } from './video_scenes/Hook';
import { DispatchScene } from './video_scenes/Dispatch';
import { InvoiceScene } from './video_scenes/Invoice';
import { PaceScene } from './video_scenes/Pace';
import { ResolveScene } from './video_scenes/Resolve';

export const SCENE_DURATIONS = {
  hook: 5000,
  dispatch: 6000,
  invoice: 6000,
  pace: 5000,
  resolve: 6000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hook: HookScene,
  dispatch: DispatchScene,
  invoice: InvoiceScene,
  pace: PaceScene,
  resolve: ResolveScene,
};

const SCENE_START_SEC: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let cumulativeMs = 0;
  for (const [key, ms] of Object.entries(SCENE_DURATIONS)) {
    out[key] = cumulativeMs / 1000;
    cumulativeMs += ms;
  }
  return out;
})();

const AUDIO_SEEK_EPSILON_SEC = 0.18;

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    const targetTime = SCENE_START_SEC[baseSceneKey] ?? 0;
    if (Math.abs(audio.currentTime - targetTime) > AUDIO_SEEK_EPSILON_SEC) {
      audio.currentTime = targetTime;
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, baseSceneKey, muted]);

  return (
    <div
      className="w-full h-screen overflow-hidden relative"
      style={{ backgroundColor: 'var(--color-bg-dark)' }}
    >
      {/* Persistent Background Elements */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div 
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[100px] opacity-20"
          style={{ background: 'radial-gradient(circle, var(--color-primary), transparent)' }}
          animate={{
            x: sceneIndex % 2 === 0 ? '-20%' : '40%',
            y: sceneIndex % 2 === 0 ? '-20%' : '40%',
            scale: sceneIndex === 4 ? 1.5 : 1,
          }}
          transition={{ duration: 5, ease: "easeInOut" }}
        />
        <motion.div 
          className="absolute w-[60vw] h-[60vw] rounded-full blur-[80px] opacity-20"
          style={{ background: 'radial-gradient(circle, var(--color-accent), transparent)', right: 0, bottom: 0 }}
          animate={{
            x: sceneIndex % 2 === 0 ? '20%' : '-30%',
            y: sceneIndex % 2 === 0 ? '20%' : '-30%',
          }}
          transition={{ duration: 7, ease: "easeInOut" }}
        />
        
        {/* Subtle grid pattern overlay */}
        <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '40px 40px', opacity: sceneIndex === 0 ? 0.3 : 0.1, transition: 'opacity 1s ease' }} />
      </div>

      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>

      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`}
        preload="auto"
        autoPlay
        muted={muted}
      />
    </div>
  );
}
