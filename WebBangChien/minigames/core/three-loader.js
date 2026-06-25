let threeLoadPromise = null;

export function loadThreeJsDynamic({ src = "vendor/three.min.js" } = {}) {
  if (window.THREE) {
    return Promise.resolve(true);
  }

  if (threeLoadPromise) {
    return threeLoadPromise;
  }

  threeLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      console.log("Đã tải thư viện Three.js thành công!");
      resolve(true);
    };
    script.onerror = () => {
      threeLoadPromise = null;
      reject(new Error(`Không thể tải thư viện Three.js từ ${src}`));
    };
    document.head.appendChild(script);
  });

  return threeLoadPromise;
}
