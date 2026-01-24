import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Tipos de documento para Persona Física
  const physicaDocs = [
    {
      code: 'CONSTANCIA_FISCAL',
      name: 'Constancia de Situación Fiscal',
      description: 'Documento emitido por el SAT',
      isRequired: true,
      requiredFor: ['FISICA', 'MORAL']
    },
    {
      code: 'ID_FRONTAL',
      name: 'Identificación Oficial (Frontal)',
      description: 'INE, pasaporte o cédula profesional (frente)',
      isRequired: true,
      requiredFor: ['FISICA']
    },
    {
      code: 'ID_REVERSO',
      name: 'Identificación Oficial (Reverso)',
      description: 'INE, pasaporte o cédula profesional (reverso)',
      isRequired: true,
      requiredFor: ['FISICA']
    },
    {
      code: 'CONTRATO',
      name: 'Contrato',
      description: 'Contrato de servicios o compraventa',
      isRequired: true,
      requiredFor: ['FISICA', 'MORAL']
    }
  ];

  console.log('Insertando tipos de documento...');
  
  for (const doc of physicaDocs) {
    await prisma.documentType.upsert({
      where: { code: doc.code },
      update: doc,
      create: doc
    });
    console.log(`✓ ${doc.name}`);
  }

  console.log('Seed completado');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());