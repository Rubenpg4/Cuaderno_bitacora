import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MCP_GUIDE_TEXT } from '../shared/mcpGuide';

describe('guía canónica de MCP y skill portátil', () => {
  it('la guía contiene las secciones clave de seguridad, herramientas y tipos', () => {
    expect(MCP_GUIDE_TEXT).toContain('¿Qué es Bitácora?');
    expect(MCP_GUIDE_TEXT).toContain('Invariantes de Seguridad y Privacidad');
    expect(MCP_GUIDE_TEXT).toContain('estado_sesion');
    expect(MCP_GUIDE_TEXT).toContain('buscar_contexto');
    expect(MCP_GUIDE_TEXT).toContain('leer_elementos');
    expect(MCP_GUIDE_TEXT).toContain('diagnosticar_tareas');
    expect(MCP_GUIDE_TEXT).toContain('proponer_cambios');
    expect(MCP_GUIDE_TEXT).toContain('consultar_propuestas');
    expect(MCP_GUIDE_TEXT).toContain('Tipos de Registros Disponibles');
    expect(MCP_GUIDE_TEXT).toContain('especificaciones');
    expect(MCP_GUIDE_TEXT).toContain('Directrices de calidad para tareas');
    expect(MCP_GUIDE_TEXT).toContain('criterios de aceptación');
    expect(MCP_GUIDE_TEXT).toContain('dependencyIds');
    expect(MCP_GUIDE_TEXT).toContain('consultar_criterios');
    expect(MCP_GUIDE_TEXT).toContain('Evaluación previa de criterios de calidad');
    expect(MCP_GUIDE_TEXT).toContain('Trabajo en tareas y verificación de criterios (`check`)');
    expect(MCP_GUIDE_TEXT).toContain(
      'criterios asociados con `consultar_criterios` antes de empezar',
    );
    expect(MCP_GUIDE_TEXT).toContain('Cumplido');
  });

  it('la guía y la skill describen la lectura ASVS por lotes y los errores de sesión', () => {
    const skill = readFileSync('.agents/skills/bitacora-mcp/SKILL.md', 'utf8');
    expect(MCP_GUIDE_TEXT).toContain('lee hasta `limit` requisitos por página');
    expect(skill).toContain('hasta `limit` por página');
    for (const text of [MCP_GUIDE_TEXT, skill]) expect(text).toContain('causa y el paso siguiente');
  });

  it('la skill fuente cubre los contratos MCP de consulta y acción', () => {
    const skill = readFileSync('.agents/skills/bitacora-mcp/SKILL.md', 'utf8');
    expect(skill).toMatch(/^---\nname: bitacora-mcp\n/);
    for (const tool of [
      'estado_sesion',
      'buscar_contexto',
      'leer_elementos',
      'consultar_criterios',
      'filtrar_registros',
      'resumir_proyecto',
      'diagnosticar_tareas',
      'consultar_relaciones',
      'proponer_cambios',
      'consultar_propuestas',
      'completar_tarea',
      'consultar_guia',
    ])
      expect(skill).toContain(tool);
    expect(skill).toContain('nextExcerptOffset');
    expect(skill).toContain('expectedVersion');
    expect(skill).toContain('canCompleteTasks: true');
  });

  it('orienta tareas de programación pequeñas y amplias desde la guía y la skill', () => {
    const skill = readFileSync('.agents/skills/bitacora-mcp/SKILL.md', 'utf8');
    for (const source of [MCP_GUIDE_TEXT, skill]) {
      expect(source).toContain('Spec-Driven Development (SDD)');
      expect(source).toContain('compatibilidad');
      expect(source).toMatch(/antes de (planificar|fijar el plan)/);
      expect(source).toContain('criterios');
      expect(source).toContain('evidencias');
      expect(source).toContain('documentación');
    }
    expect(MCP_GUIDE_TEXT).toContain('Para un cambio pequeño');
    expect(skill).toContain('Para un cambio acotado');
    expect(MCP_GUIDE_TEXT).toContain('Para varias historias');
    expect(skill).toContain('Para varias historias');
    // At least 1,000 characters below the original 15,000 cap.
    expect(MCP_GUIDE_TEXT.length).toBeLessThan(14_000);
  });

  it('limita las propuestas de decisión a elecciones duraderas o pedidas', () => {
    const skill = readFileSync('.agents/skills/bitacora-mcp/SKILL.md', 'utf8');
    for (const source of [MCP_GUIDE_TEXT, skill]) {
      expect(source).toMatch(/una tarea no implica una decisión/i);
      expect(source).toContain('alternativas reales');
      expect(source).toMatch(/la persona (la|lo) pid/);
    }
  });

  it('guía la selección heurística y la convergencia ASVS sin ampliar autoridad', () => {
    const skill = readFileSync('.agents/skills/bitacora-mcp/SKILL.md', 'utf8');
    for (const source of [MCP_GUIDE_TEXT, skill]) {
      expect(source).toContain('consultar_criterios_asvs');
      expect(source).toContain('proponer_verificacion_asvs');
      expect(source).toContain('asvsIds');
      expect(source).toContain('manuales');
      expect(source).toContain('heurística');
      expect(source).toContain('desactivado');
      expect(source).toContain('nivel objetivo');
    }
  });
});
