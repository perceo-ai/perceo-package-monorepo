import { Persona, Flow } from './claude';

/**
 * Merge personas, deduplicating by name (case-insensitive)
 */
export function mergePersonas(
  existingMap: Map<string, Persona>,
  newPersonas: Persona[]
): void {
  for (const persona of newPersonas) {
    const key = persona.name.toLowerCase();

    if (existingMap.has(key)) {
      // Merge behaviors, avoiding duplicates
      const existing = existingMap.get(key)!;
      const behaviorSet = new Set([
        ...existing.behaviors,
        ...persona.behaviors,
      ]);
      existing.behaviors = Array.from(behaviorSet);

      // Use longer description if available
      if (persona.description.length > existing.description.length) {
        existing.description = persona.description;
      }
    } else {
      existingMap.set(key, persona);
    }
  }
}

/**
 * Merge flows, deduplicating by name + persona (case-insensitive)
 */
export function mergeFlows(
  existingMap: Map<string, Flow>,
  newFlows: Flow[]
): void {
  for (const flow of newFlows) {
    const key = `${flow.personaName.toLowerCase()}:${flow.name.toLowerCase()}`;

    if (existingMap.has(key)) {
      // Merge trigger conditions, avoiding duplicates
      const existing = existingMap.get(key)!;
      const triggerSet = new Set([
        ...existing.triggerConditions,
        ...flow.triggerConditions,
      ]);
      existing.triggerConditions = Array.from(triggerSet);

      // Use longer description if available
      if (flow.description.length > existing.description.length) {
        existing.description = flow.description;
      }
    } else {
      existingMap.set(key, flow);
    }
  }
}

/**
 * Validate that flow personas exist in persona list
 */
export function validateFlowPersonas(
  flows: Flow[],
  personas: Persona[]
): Flow[] {
  const personaNames = new Set(
    personas.map((p) => p.name.toLowerCase())
  );

  return flows.filter((flow) => {
    const hasValidPersona = personaNames.has(flow.personaName.toLowerCase());
    if (!hasValidPersona) {
      console.warn(
        `Flow "${flow.name}" references unknown persona "${flow.personaName}"`
      );
    }
    return hasValidPersona;
  });
}
