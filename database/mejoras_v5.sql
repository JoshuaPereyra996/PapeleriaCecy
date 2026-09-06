USE Pruebas;

-- Turno en que se imparte el libro (Matutino/Vespertino). NULL = sin
-- clasificar, igual que libros.grado: aparece en cualquier turno hasta que
-- se le asigne uno.
ALTER TABLE libros
  ADD COLUMN turno VARCHAR(20) NULL AFTER grado;
