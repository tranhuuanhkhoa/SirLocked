/*
 * Moved as it is from the approved prototype (ho-so-src/art-manifest.js): only imports and exports were added,
 * plus the changes listed in cosmetics/README.md. The drawing is not to be redrawn or simplified.
 */
/* Painted artwork for cosmetics. Copy assets/cosmetics/* to src/FE/public/assets/cosmetics/.
   ARTM: placement of each painted frame in the 200x200 frame box (x,y,w,h = image rect; hx,hy,hr = avatar hole). */
const ART = {
 "vien-dong": "/assets/cosmetics/vien-dong.webp",
 "vien-bac": "/assets/cosmetics/vien-bac.webp",
 "vien-ngoc": "/assets/cosmetics/vien-ngoc.webp",
 "vien-vang": "/assets/cosmetics/vien-vang.webp",
 "vien-truong": "/assets/cosmetics/vien-truong.webp",
 "vien-thach": "/assets/cosmetics/vien-thach.webp",
 "vien-mac": "/assets/cosmetics/vien-mac.webp",
 "vien-bang": "/assets/cosmetics/vien-bang.webp",
 "vien-sonmai": "/assets/cosmetics/vien-sonmai.webp",
 "vien-ulinh": "/assets/cosmetics/vien-ulinh.webp",
 "vien-tinhkhong": "/assets/cosmetics/vien-tinhkhong.webp",
 "vien-lua": "/assets/cosmetics/vien-lua.webp",
 "rong-cuon": "/assets/cosmetics/rong-cuon.webp",
 "rong-bay": "/assets/cosmetics/rong-bay.webp",
 "phuong-xoe": "/assets/cosmetics/phuong-xoe.webp",
 "phuong-bay": "/assets/cosmetics/phuong-bay.webp",
 "vien-thach-glow": "/assets/cosmetics/vien-thach-glow.webp",
 "vien-lua-glow": "/assets/cosmetics/vien-lua-glow.webp",
 "rong-cuon-glow": "/assets/cosmetics/rong-cuon-glow.webp",
 "kiem": "/assets/cosmetics/kiem.webp"
};
const ARTM = {"vien-dong": {"s": 0.728, "x": 9.88, "y": 5.51, "w": 179.81, "h": 188.54, "hx": 100, "hy": 100, "hr": 57.0}, "vien-bac": {"s": 0.6778, "x": 16.77, "y": 4.71, "w": 166.05, "h": 179.61, "hx": 100, "hy": 100, "hr": 57.0}, "vien-ngoc": {"s": 0.6759, "x": 17.88, "y": 2.0, "w": 164.91, "h": 196.0, "hx": 100, "hy": 87.9, "hr": 52.45}, "vien-vang": {"s": 0.695, "x": 16.11, "y": 2.0, "w": 168.2, "h": 196.0, "hx": 100, "hy": 98.05, "hr": 47.75}, "vien-truong": {"s": 0.7232, "x": 3.81, "y": 2.0, "w": 191.66, "h": 196.0, "hx": 100, "hy": 107.74, "hr": 55.47}, "vien-thach": {"s": 0.7626, "x": 2.92, "y": 2.0, "w": 192.95, "h": 196.0, "hx": 100, "hy": 101.68, "hr": 55.67}, "vien-mac": {"s": 0.7308, "x": 6.83, "y": 11.58, "w": 165.88, "h": 178.31, "hx": 100, "hy": 100, "hr": 57.0}, "vien-bang": {"s": 0.7341, "x": 7.21, "y": 2.0, "w": 184.25, "h": 196.0, "hx": 100, "hy": 107.56, "hr": 55.06}, "vien-sonmai": {"s": 0.7252, "x": 8.05, "y": 8.26, "w": 173.32, "h": 187.1, "hx": 100, "hy": 100, "hr": 57.0}, "vien-ulinh": {"s": 0.6926, "x": 18.83, "y": 2.0, "w": 157.22, "h": 196.0, "hx": 100, "hy": 104.78, "hr": 52.98}, "vien-tinhkhong": {"s": 0.753, "x": 4.82, "y": 2.0, "w": 184.48, "h": 192.01, "hx": 100, "hy": 104.18, "hr": 57.0}, "vien-lua": {"s": 0.7025, "x": 12.05, "y": 2.0, "w": 174.22, "h": 196.0, "hx": 100, "hy": 102.39, "hr": 54.02}, "rong-cuon": {"s": 0.5444, "x": 24.49, "y": 2.0, "w": 149.18, "h": 196.0, "hx": 100, "hy": 109.96, "hr": 43.01}, "rong-bay": {"w": 558, "h": 290}, "phuong-xoe": {"w": 272, "h": 362}, "phuong-bay": {"w": 434, "h": 331}};

export { ART, ARTM };
