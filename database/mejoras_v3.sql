USE Pruebas;
ALTER TABLE libros
  ADD COLUMN comision_maestro DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER margen_papeleria;