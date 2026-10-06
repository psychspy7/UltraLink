/**
 * UltraLink Goertzel Filter Bank & Dynamic SNR Evaluation
 * Continuous frequency power estimation independent of FFT bin quantization
 * with adaptive noise floor tracking and parabolic interpolation.
 */

export interface GoertzelResult {
  peakFrequency: number;
  peakIndex: number;
  peakPower: number;
  noiseFloor: number;
  snrDb: number;
  powers: number[];
}

export class GoertzelFilterBank {
  private frequencies: number[];
  private sampleRate: number;
  private coeffs: Float64Array;
  private guardFreq: number;
  private guardCoeff: number;
  private carrierOffset = 0; // AFC Doppler / clock drift correction in Hz

  constructor(frequencies: number[], sampleRate: number, guardFreq = 16800) {
    this.frequencies = [...frequencies];
    this.sampleRate = sampleRate;
    this.guardFreq = guardFreq;
    this.coeffs = new Float64Array(frequencies.length);
    this.guardCoeff = 0;
    this.updateCoefficients();
  }

  /**
   * Set Automatic Frequency Control (AFC) carrier offset in Hz
   */
  public setCarrierOffset(offsetHz: number): void {
    this.carrierOffset = offsetHz;
    this.updateCoefficients();
  }

  public getCarrierOffset(): number {
    return this.carrierOffset;
  }

  /**
   * Update sample rate and recompute coefficients
   */
  public setSampleRate(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.updateCoefficients();
  }

  /**
   * Update target frequencies
   */
  public setFrequencies(frequencies: number[]): void {
    this.frequencies = [...frequencies];
    this.coeffs = new Float64Array(frequencies.length);
    this.updateCoefficients();
  }

  private updateCoefficients(): void {
    for (let i = 0; i < this.frequencies.length; i++) {
      const f = this.frequencies[i] + this.carrierOffset;
      const omega = (2 * Math.PI * f) / this.sampleRate;
      this.coeffs[i] = 2 * Math.cos(omega);
    }
    const guardOmega = (2 * Math.PI * (this.guardFreq + this.carrierOffset)) / this.sampleRate;
    this.guardCoeff = 2 * Math.cos(guardOmega);
  }

  /**
   * Compute power at a specific arbitrary continuous frequency
   */
  public static computeSingleFrequencyPower(
    freq: number,
    samples: Float32Array,
    sampleRate: number,
    offset = 0,
    length = samples.length - offset
  ): number {
    const N = Math.min(length, samples.length - offset);
    if (N <= 0) return 0;

    const omega = (2 * Math.PI * freq) / sampleRate;
    const coeff = 2 * Math.cos(omega);

    let s0 = 0;
    let s1 = 0;
    let s2 = 0;

    const end = offset + N;
    for (let i = offset; i < end; i++) {
      s0 = samples[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    return (4 * power) / (N * N);
  }

  /**
   * Evaluate all filter bank bins over a slice of samples
   */
  public evaluate(
    samples: Float32Array,
    offset = 0,
    length = samples.length - offset
  ): GoertzelResult {
    const N = Math.min(length, samples.length - offset);
    const powers: number[] = new Array(this.frequencies.length);
    const end = offset + N;

    if (N <= 0) {
      return {
        peakFrequency: this.frequencies[0] || 0,
        peakIndex: 0,
        peakPower: 0,
        noiseFloor: 0,
        snrDb: 0,
        powers: new Array(this.frequencies.length).fill(0),
      };
    }

    let peakPower = -1;
    let peakIndex = 0;

    // Evaluate each bank frequency
    for (let k = 0; k < this.frequencies.length; k++) {
      const coeff = this.coeffs[k];
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;

      for (let i = offset; i < end; i++) {
        s0 = samples[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }

      const p = (4 * (s1 * s1 + s2 * s2 - coeff * s1 * s2)) / (N * N);
      powers[k] = p;

      if (p > peakPower) {
        peakPower = p;
        peakIndex = k;
      }
    }

    // Evaluate guard frequency power
    let gs0 = 0;
    let gs1 = 0;
    let gs2 = 0;
    for (let i = offset; i < end; i++) {
      gs0 = samples[i] + this.guardCoeff * gs1 - gs2;
      gs2 = gs1;
      gs1 = gs0;
    }
    const guardPower = (4 * (gs1 * gs1 + gs2 * gs2 - this.guardCoeff * gs1 * gs2)) / (N * N);

    // Calculate noise floor as median of inactive bins plus guard bin
    const inactivePowers = powers.filter((_, idx) => idx !== peakIndex);
    inactivePowers.push(guardPower);
    inactivePowers.sort((a, b) => a - b);

    const mid = Math.floor(inactivePowers.length / 2);
    const noiseFloor =
      inactivePowers.length % 2 === 0
        ? (inactivePowers[mid - 1] + inactivePowers[mid]) / 2
        : inactivePowers[mid];

    const eps = 1e-12;
    const snrDb = 10 * Math.log10((peakPower + eps) / (noiseFloor + eps));

    return {
      peakFrequency: this.frequencies[peakIndex] + this.carrierOffset,
      peakIndex,
      peakPower,
      noiseFloor,
      snrDb,
      powers,
    };
  }

  /**
   * Refine peak frequency using 3-point parabolic interpolation
   */
  public refinePeakFrequency(
    samples: Float32Array,
    nominalFreq: number,
    deltaHz = 50,
    offset = 0,
    length = samples.length - offset
  ): number {
    const pCenter = GoertzelFilterBank.computeSingleFrequencyPower(
      nominalFreq,
      samples,
      this.sampleRate,
      offset,
      length
    );
    const pLeft = GoertzelFilterBank.computeSingleFrequencyPower(
      nominalFreq - deltaHz,
      samples,
      this.sampleRate,
      offset,
      length
    );
    const pRight = GoertzelFilterBank.computeSingleFrequencyPower(
      nominalFreq + deltaHz,
      samples,
      this.sampleRate,
      offset,
      length
    );

    const denom = 2 * (2 * pCenter - pLeft - pRight);
    if (Math.abs(denom) < 1e-12) {
      return nominalFreq;
    }

    const delta = (pRight - pLeft) / denom;
    // Bound delta to [-1.0, 1.0] to prevent divergent estimates
    const boundedDelta = Math.max(-1.0, Math.min(1.0, delta));
    return nominalFreq + boundedDelta * deltaHz;
  }
}
