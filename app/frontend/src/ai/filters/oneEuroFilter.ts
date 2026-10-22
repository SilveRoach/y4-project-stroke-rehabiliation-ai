/**
 * One-Euro Filter สำหรับสัญญาณสเกลาร์ 1 ค่า (เช่น พิกัด x ของ landmark จุดเดียว) ตามเวลา
 * สำคัญ: instance เก็บ state ของสัญญาณเส้นเดียว ต้องสร้างแยก instance ต่อ 1 พิกัด ต่อ 1 landmark
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  private xPrev: number | null = null;
  private dxPrev: number | null = null;
  private lastTime: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(rate: number, cutoff: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    const te = 1.0 / rate;
    return 1.0 / (1.0 + tau / te);
  }

  filter(x: number, timestamp: number): number {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      this.xPrev = x;
      this.dxPrev = null;
      return x;
    }

    const dt = (timestamp - this.lastTime) / 1000.0;
    this.lastTime = timestamp;
    const rate = dt > 0 ? 1.0 / dt : 30.0;

    const dx = (x - (this.xPrev ?? x)) * rate;
    const alphaD = this.alpha(rate, this.dCutoff);
    const edx = this.dxPrev === null ? dx : alphaD * dx + (1.0 - alphaD) * this.dxPrev;
    this.dxPrev = edx;

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const alphaX = this.alpha(rate, cutoff);
    const xHat = alphaX * x + (1.0 - alphaX) * (this.xPrev as number);
    this.xPrev = xHat;

    return xHat;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = null;
    this.lastTime = null;
  }
}
