// Air distance between two map points for the measuring tool: the geodesic on the WGS84 ellipsoid
// by Vincenty's inverse formula (accurate to well under a millimetre at the distances on this map).

const A = 6378137; // semi-major axis (m)
const F = 1 / 298.257223563; // flattening
const B = A * (1 - F); // semi-minor axis (m)
const RAD = Math.PI / 180;

/**
 * Distance in metres between two [lon, lat] points in degrees. Vincenty's iteration fails to
 * converge only for nearly antipodal points, which this map never has.
 */
export function geodesicDistance([lon1, lat1], [lon2, lat2]) {
  const L = (lon2 - lon1) * RAD;
  const U1 = Math.atan((1 - F) * Math.tan(lat1 * RAD));
  const U2 = Math.atan((1 - F) * Math.tan(lat2 * RAD));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

  let lambda = L;
  let previous;
  let sinSigma, cosSigma, sigma, cos2Alpha, cos2SigmaM;
  let iterations = 0;
  do {
    const sinLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) return 0; // the same point
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha; // 0 on the equator
    const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
    previous = lambda;
    lambda = L + (1 - C) * F * sinAlpha
      * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - previous) > 1e-12 && ++iterations < 200);

  const u2 = (cos2Alpha * (A * A - B * B)) / (B * B);
  const bigA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const bigB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const deltaSigma = bigB * sinSigma * (cos2SigmaM + (bigB / 4) * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)
    - (bigB / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  return B * bigA * (sigma - deltaSigma);
}
