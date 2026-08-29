-- ===========================================================================
-- Pokédex TCG · esquema MySQL / MariaDB
-- Ejecutar una sola vez en phpMyAdmin (hPanel → Bases de datos → phpMyAdmin)
-- o con:  npm run migrar
-- ===========================================================================

-- --------------------------------------------------------------- usuarios --
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,          -- bcrypt, nunca la contraseña en claro
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP    NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------- Módulo 1: Pokédex Nacional --
-- Una fila por especie registrada. La PK compuesta garantiza el invariante
-- del proyecto: 1 Pokémon = 1 carta por usuario.
CREATE TABLE IF NOT EXISTS pokedex_entries (
  user_id    INT UNSIGNED NOT NULL,
  dex_id     SMALLINT UNSIGNED NOT NULL,        -- nº de Pokédex Nacional
  card_id    VARCHAR(64)  NOT NULL,             -- p.ej. sv3pt5-173
  card_name  VARCHAR(128) NOT NULL DEFAULT '',
  card_image VARCHAR(255) NOT NULL DEFAULT '',
  set_name   VARCHAR(128) NOT NULL DEFAULT '',
  -- "La tengo, pero sigo buscando otra versión": arte alterno, rareza distinta,
  -- reimpresión… El slot cuenta como obtenido, pero se marca en rojo.
  wants_alt  TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, dex_id),
  KEY idx_pokedex_wants_alt (user_id, wants_alt),
  CONSTRAINT fk_pokedex_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------ Módulo 2: Illustration Rares --
CREATE TABLE IF NOT EXISTS rare_entries (
  user_id        INT UNSIGNED NOT NULL,
  card_id        VARCHAR(64)  NOT NULL,
  card_condition ENUM('NM','LP','MP','HP','DMG') NOT NULL DEFAULT 'NM',
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, card_id),
  CONSTRAINT fk_rares_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ======================================================================
-- Lienzo de carpetas (Fase 1) · producto para tiendas / carpeteros
-- ======================================================================

-- ------------------------------------------------------------- carpetas --
-- Cada carpeta es una tarjeta del lienzo principal. `kind` distingue las
-- dos carpetas ESPECIALES (pokedex, rares), cuyo interior sigue leyendo
-- pokedex_entries / rare_entries y NO usa la rejilla configurable, de las
-- carpetas 'normal', que sí tienen rejilla elegible (2x2,3x3,4x4,5x4,5x5).
CREATE TABLE IF NOT EXISTS folders (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id   INT UNSIGNED NOT NULL,               -- preparado para multiusuario
  name       VARCHAR(96)  NOT NULL,
  color      VARCHAR(16)  NOT NULL DEFAULT '#3b82f6',
  kind       ENUM('normal','pokedex','rares') NOT NULL DEFAULT 'normal',
  rows_count TINYINT UNSIGNED NOT NULL DEFAULT 3, -- filas de la rejilla
  cols_count TINYINT UNSIGNED NOT NULL DEFAULT 3, -- columnas de la rejilla
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,     -- orden en el lienzo (rejilla ordenada)
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_folders_owner (owner_id, sort_order),
  -- Solo puede existir UNA carpeta especial de cada tipo por usuario.
  UNIQUE KEY uq_folders_special (owner_id, kind, name),
  CONSTRAINT fk_folders_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------ inventario --
-- Una fila = una COPIA física de una carta. Por eso una misma card_id puede
-- repetirse: el vendedor tiene varias copias. La ubicación no vive aquí,
-- vive en card_placements (una copia puede estar sin colocar todavía).
CREATE TABLE IF NOT EXISTS inventory_items (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id    INT UNSIGNED NOT NULL,
  card_id     VARCHAR(64)  NOT NULL,              -- id de catálogo, p.ej. sv3pt5-173
  card_name   VARCHAR(128) NOT NULL DEFAULT '',
  card_image  VARCHAR(255) NOT NULL DEFAULT '',
  set_name    VARCHAR(128) NOT NULL DEFAULT '',
  quantity    INT UNSIGNED NOT NULL DEFAULT 1,
  card_condition ENUM('NM','LP','MP','HP','DMG') NOT NULL DEFAULT 'NM',
  cost        DECIMAL(10,2) NULL DEFAULT NULL,    -- precio de compra
  price       DECIMAL(10,2) NULL DEFAULT NULL,    -- precio de venta
  acquired_at DATE          NULL DEFAULT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inventory_owner_card (owner_id, card_id),
  CONSTRAINT fk_inventory_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------- ubicación en carpeta --
-- Puente carta↔hueco. UNIQUE(folder_id,page,row,col) impide ocupar dos veces
-- el mismo hueco, pero la misma carta puede estar en varios huecos/carpetas:
-- así el buscador de mostrador puede listar TODAS las ubicaciones.
CREATE TABLE IF NOT EXISTS card_placements (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  folder_id  INT UNSIGNED NOT NULL,
  item_id    INT UNSIGNED NOT NULL,               -- qué copia física ocupa el hueco
  page       SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  row_pos    TINYINT UNSIGNED NOT NULL,           -- 0-based
  col_pos    TINYINT UNSIGNED NOT NULL,           -- 0-based
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_placement_slot (folder_id, page, row_pos, col_pos),
  KEY idx_placement_item (item_id),
  CONSTRAINT fk_placement_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
  CONSTRAINT fk_placement_item   FOREIGN KEY (item_id)   REFERENCES inventory_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------- sesiones --
-- express-mysql-session la crea sola, pero la dejamos explícita para que
-- exista con el juego de caracteres correcto desde el principio.
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) NOT NULL,
  expires    INT UNSIGNED NOT NULL,
  data       MEDIUMTEXT,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
