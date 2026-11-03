# gitprofiles.xyz

GitHub ile giriş yapıp tek bir geliştirici profilini düzenlemeye, yayınlamaya ve paylaşmaya yönelik web/masaüstü stüdyosu. Sol paneldeki değişiklikler profil önizlemesine anında yansır; yayınlanan sayfalar `https://gitprofiles.xyz/kullaniciadi` benzeri bir rotadan okunur.

## Teknoloji

- React, TypeScript, Vite ve Tailwind CSS
- Web ve Electron masaüstü derlemesi
- Opsiyonel Rust/N-API profil doğrulama modülü
- Supabase Auth, Postgres ve Storage

## Yerel çalıştırma

```sh
npm install
npm run web
```

Masaüstü uygulamasını Vite ile birlikte açmak için:

```sh
npm run dev
```

## GitHub girişi ve canlı profiller

1. Bir Supabase projesi oluştur ve GitHub OAuth uygulamasını Supabase Auth sağlayıcısına bağla. GitHub OAuth uygulamasının callback adresi `https://<project-ref>.supabase.co/auth/v1/callback` olmalıdır.
2. Supabase Auth URL yapılandırmasında web adresini (`https://gitprofiles.xyz/auth/callback`), yerel web adreslerini (`http://127.0.0.1:5173/auth/callback` ve `http://localhost:5173/auth/callback`) ve Electron deep-link adresini (`gitprofiles://auth/callback`) izin verilen yönlendirmelere ekle.
3. `supabase/migrations/20261103000000_profiles.sql` migrasyonunu Supabase SQL Editor üzerinden çalıştır. Profil kayıtları için RLS, medya için kullanıcı klasörüne dayalı Storage politikaları ve `profile-media` bucket'ı bu migrasyonda tanımlıdır.
4. `.env.example` dosyasını `.env.local` olarak kopyalayıp proje URL'si, public/anon key ve yayın adresini gir:

```sh
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
VITE_PUBLIC_URL=https://gitprofiles.xyz
```

5. Supabase projesinde GitHub sağlayıcısını etkinleştir. OAuth client secret yalnızca Supabase sağlayıcı ayarlarında tutulur; renderer'a veya repoya eklenmez.

Geliştirme ortamında ayarları tamamlayınca `npm run dev` ile web veya Electron akışından giriş yapabilirsin. Auth callback'teki PKCE kodu istemci SDK'siyle değiştirilir. Electron preload sadece dışarıda GitHub/Supabase adresini açma, doğrulama ve auth callback dinleme kabiliyetlerini renderer'a sunar; Node entegrasyonu kapalı ve context isolation açıktır.

## Profil ve medya

- GitHub kimliği yeni profile başlangıç sağlar; ad, bio, sosyal hesaplar ve 12'ye kadar özel link kartı düzenlenebilir.
- Renk teması, degrade, görsel URL'si, MP4/WebM arka plan URL'si ve masaüstü/telefon önizlemesi bulunur.
- Yüklenen avatar ve arka plan görselleri tarayıcıda WebP'ye küçültülür. Video dosyaları en fazla 40 MB'dır ve görünür hale geldiklerinde yüklenip oynatılır.
- İlk yayınlamadan sonra profil kaydı Postgres'te saklanır; geçerli düzenlemeler kısa bir beklemeden sonra otomatik güncellenir. Herkese açık profil rotası yalnızca `published = true` kayıtları okur; Storage içeriği herkese açık CDN URL'siyle sunulur, yükleme/değiştirme/silme ise oturum sahibinin klasörüyle sınırlandırılır.
- `Save / Share Profile` gerçek profil URL'sini üretir; paylaşım penceresi ayrıca GitHub README için SVG kart ve HTML/Markdown yerleştirme kodu verir.

## Web dağıtımı

Vercel yapılandırması `vercel.json` içinde SPA fallback ve web varlıkları için kök (`/`) base ayarıyla tanımlıdır. Vercel proje ayarlarında `.env.local` değerlerinin aynısını ortam değişkeni olarak ekle. Diğer statik barındırmalarda `npm run build:web` çalıştır ve bilinmeyen rotaları `index.html` dosyasına yönlendir.

```sh
npm run build:web
```

## Kontrol ve derleme

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` Electron'da `file://` varlık yollarına uygun paket derlemesidir. `npm run build:web` ise barındırılan web uygulaması için kök yolları üretir.

Rust modülünü yerel makinede derleyip masaüstü dağıtımını hazırlamak için Rust toolchain gerekir:

```sh
npm run native:build
npm run dist
```

N-API ikilileri işletim sistemi ve mimariye özeldir; hedef platformlarda ayrı ayrı derlenip doğrulanmalıdır.
