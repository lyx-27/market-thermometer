import { Composition } from 'remotion';
import { Demo } from './Demo';

const FPS = 30;
const DURATION = 18 * FPS; // 18s

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="MarketGlassDemo"
        component={Demo}
        durationInFrames={DURATION}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ orientation: 'landscape' }}
      />
      <Composition
        id="MarketGlassVertical"
        component={Demo}
        durationInFrames={DURATION}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ orientation: 'portrait' }}
      />
    </>
  );
};
