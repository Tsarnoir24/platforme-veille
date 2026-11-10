import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import AppDataSource from './data-source';
import { Role } from '../roles/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { UserPasswordHistory } from '../auth/entities/user-password-history.entity';

async function runSeed() {
  console.log('--- Initialisation du Seed TypeORM ---');

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const roleRepo = AppDataSource.getRepository(Role);
  const userRepo = AppDataSource.getRepository(User);
  const historyRepo = AppDataSource.getRepository(UserPasswordHistory);

  // 1. Initialisation des rôles
  const roles = [
    { name: 'ADMIN', description: 'Administrateur' },
    { name: 'RESPONSABLE_VEILLE', description: 'Responsable veille / Qualité' },
    { name: 'REFERENT_LABORATOIRE', description: 'Référent laboratoire' },
    { name: 'LECTEUR', description: 'Lecteur' },
    {
      name: 'OPERATEUR_VEILLE',
      description: 'Stagiaire / opérateur de veille',
    },
  ];

  for (const roleData of roles) {
    let role = await roleRepo.findOne({ where: { name: roleData.name } });
    if (!role) {
      role = roleRepo.create(roleData);
      await roleRepo.save(role);
      console.log(`[+] Rôle créé : ${role.name}`);
    } else {
      console.log(`[=] Rôle déjà présent : ${role.name}`);
    }
  }

  // 2. Initialisation du compte administrateur initial
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const rawPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !rawPassword) {
    console.warn(
      '[!] Attention : SEED_ADMIN_EMAIL ou SEED_ADMIN_PASSWORD non renseigné dans le fichier .env',
    );
    await AppDataSource.destroy();
    return;
  }

  const existingAdmin = await userRepo.findOne({ where: { email } });
  if (existingAdmin) {
    console.log(`[=] Le compte administrateur ${email} existe déjà.`);
    await AppDataSource.destroy();
    return;
  }

  const adminRole = await roleRepo.findOneBy({ name: 'ADMIN' });
  if (!adminRole) {
    console.error('[-] Erreur : Rôle ADMIN manquant.');
    await AppDataSource.destroy();
    return;
  }

  // Hachage sécurisé bcrypt (12 tours)
  const passwordHash = await bcrypt.hash(rawPassword, 12);

  const admin = userRepo.create({
    firstName: 'Administrateur',
    lastName: 'Plateforme',
    email,
    passwordHash,
    status: 'ACTIVE',
    mustChangePassword: true,
    roles: [adminRole],
  });

  const savedAdmin = await userRepo.save(admin);

  // Historique des mots de passe
  await historyRepo.save(
    historyRepo.create({
      userId: savedAdmin.id,
      passwordHash,
    }),
  );

  console.log(`[+] Compte administrateur initial créé avec succès : ${email}`);
  console.log(
    '    (Note: mustChangePassword=true est activé pour forcer la personnalisation du mot de passe)',
  );

  await AppDataSource.destroy();
  console.log('--- Seed terminé avec succès ---');
}

runSeed().catch((err) => {
  console.error('Erreur durant l’exécution du seed :', err);
  process.exit(1);
});
