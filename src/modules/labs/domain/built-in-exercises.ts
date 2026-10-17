import { LabKey } from './lab-catalog.js';
import type { BuiltInExercise } from './ports/lab.ports.js';

// Fixed ids, so activities keep pointing at the same exercise however often the bank is written
const id = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const completion = (n: number, prompt: string, answers: string[], hint: string | null = null): BuiltInExercise => ({
  id: id(n),
  labKey: LabKey.COMPLETIONS,
  prompt,
  answers,
  hint,
});

const definition = (n: number, prompt: string, answers: string[], hint: string | null = null): BuiltInExercise => ({
  id: id(n),
  labKey: LabKey.DEFINITIONS,
  prompt,
  answers,
  hint,
});

/** The platform's own Spanish exercises, offered to every institution with the language labs. */
export const BUILT_IN_EXERCISES: readonly BuiltInExercise[] = [
  completion(1, 'Ayer nosotros ___ al parque con nuestros primos.', ['fuimos'], 'Verbo ir, pretérito'),
  completion(2, 'Si tuviera tiempo, ___ un libro cada semana.', ['leería'], 'Verbo leer, condicional'),
  completion(3, 'El sujeto de la oración concuerda con el ___ en número y persona.', ['verbo']),
  completion(4, 'Las palabras agudas llevan tilde cuando terminan en vocal, ___ o s.', ['n', 'ene']),
  completion(5, 'Espero que mañana ___ buen tiempo para la excursión.', ['haga'], 'Verbo hacer, subjuntivo'),
  completion(6, 'Cuando era niño, mi abuela me ___ cuentos todas las noches.', ['contaba'], 'Verbo contar, pretérito imperfecto'),
  completion(7, '«Rápidamente» es un adverbio de ___.', ['modo']),
  completion(8, 'El plural de «lápiz» es ___.', ['lápices']),
  completion(9, 'Un sinónimo de «alegre» es ___.', ['contento', 'feliz', 'jubiloso', 'dichoso']),
  completion(10, 'Un antónimo de «generoso» es ___.', ['tacaño', 'avaro', 'egoísta', 'mezquino']),
  completion(11, 'La palabra «árbol» es ___ porque lleva el acento en la penúltima sílaba.', ['llana', 'grave']),
  completion(12, 'Los dos puntos se usan antes de una ___ de elementos.', ['enumeración', 'lista']),
  definition(101, 'Palabra que expresa una acción, un estado o un proceso, y se conjuga.', ['verbo']),
  definition(102, 'Palabra que acompaña al sustantivo para expresar una cualidad suya.', ['adjetivo']),
  definition(103, 'Palabra que tiene un significado igual o muy parecido al de otra.', ['sinónimo']),
  definition(104, 'Palabra que tiene un significado opuesto al de otra.', ['antónimo']),
  definition(105, 'Comparación entre dos elementos usando «como» o «cual».', ['símil', 'comparación']),
  definition(106, 'Atribución de cualidades humanas a animales u objetos.', ['personificación', 'prosopopeya']),
  definition(107, 'Repetición de sonidos iguales o parecidos en palabras próximas.', ['aliteración']),
  definition(108, 'Exageración intencionada de lo que se dice.', ['hipérbole']),
  definition(109, 'Texto breve en verso o prosa que deja una enseñanza moral, con animales como personajes.', ['fábula']),
  definition(110, 'Persona que cuenta los hechos en un relato.', ['narrador', 'narradora']),
  definition(111, 'Unión de dos vocales en una misma sílaba.', ['diptongo']),
  definition(112, 'Signo que se escribe sobre una vocal para marcar el acento.', ['tilde']),
];
