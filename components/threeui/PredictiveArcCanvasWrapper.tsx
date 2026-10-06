'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import type { PredictiveArcCanvasProps } from './PredictiveArcCanvas';

const DynamicPredictiveArcCanvas = dynamic<PredictiveArcCanvasProps>(
  () => import('./PredictiveArcCanvas').then((mod) => mod.PredictiveArcCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full h-full bg-[#070B14] opacity-50"
        aria-hidden="true"
      />
    ),
  }
);

export const PredictiveArcCanvasWrapper: React.FC<PredictiveArcCanvasProps> = (props) => {
  return <DynamicPredictiveArcCanvas {...props} />;
};

export default PredictiveArcCanvasWrapper;
