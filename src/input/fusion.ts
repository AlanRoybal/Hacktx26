import * as THREE from 'three';

/** Madgwick IMU filter (gyro + accel), 200 Hz. Quaternion in the Joy-Con sensor frame. */
export class Madgwick {
  q = new THREE.Quaternion();
  constructor(public beta = 0.08) {}

  update(gx: number, gy: number, gz: number, ax: number, ay: number, az: number, dt: number) {
    let { w: q0, x: q1, y: q2, z: q3 } = this.q;
    let qd0 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
    let qd1 = 0.5 * (q0 * gx + q2 * gz - q3 * gy);
    let qd2 = 0.5 * (q0 * gy - q1 * gz + q3 * gx);
    let qd3 = 0.5 * (q0 * gz + q1 * gy - q2 * gx);
    const an = Math.hypot(ax, ay, az);
    if (an > 0.3 && an < 3) {               // only trust gravity when not mid-throw
      ax /= an; ay /= an; az /= an;
      const _2q0 = 2 * q0, _2q1 = 2 * q1, _2q2 = 2 * q2, _2q3 = 2 * q3;
      const _4q0 = 4 * q0, _4q1 = 4 * q1, _4q2 = 4 * q2, _8q1 = 8 * q1, _8q2 = 8 * q2;
      const q0q0 = q0 * q0, q1q1 = q1 * q1, q2q2 = q2 * q2, q3q3 = q3 * q3;
      let s0 = _4q0 * q2q2 + _2q2 * ax + _4q0 * q1q1 - _2q1 * ay;
      let s1 = _4q1 * q3q3 - _2q3 * ax + 4 * q0q0 * q1 - _2q0 * ay - _4q1 + _8q1 * q1q1 + _8q1 * q2q2 + _4q1 * az;
      let s2 = 4 * q0q0 * q2 + _2q0 * ax + _4q2 * q3q3 - _2q3 * ay - _4q2 + _8q2 * q1q1 + _8q2 * q2q2 + _4q2 * az;
      let s3 = 4 * q1q1 * q3 - _2q1 * ax + 4 * q2q2 * q3 - _2q2 * ay;
      const sn = Math.hypot(s0, s1, s2, s3) || 1;
      s0 /= sn; s1 /= sn; s2 /= sn; s3 /= sn;
      qd0 -= this.beta * s0; qd1 -= this.beta * s1; qd2 -= this.beta * s2; qd3 -= this.beta * s3;
    }
    q0 += qd0 * dt; q1 += qd1 * dt; q2 += qd2 * dt; q3 += qd3 * dt;
    const n = Math.hypot(q0, q1, q2, q3) || 1;
    this.q.set(q1 / n, q2 / n, q3 / n, q0 / n);
  }
}
