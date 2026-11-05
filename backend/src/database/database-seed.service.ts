import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import * as bcrypt from 'bcrypt';

import { Role } from '../roles/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { UserPasswordHistory } from '../auth/entities/user-password-history.entity';

@Injectable()
export class DatabaseSeedService
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(DatabaseSeedService.name);

  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(UserPasswordHistory)
    private readonly passwordHistoryRepository: Repository<UserPasswordHistory>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedRoles();
    await this.seedAdmin();
  }

  async seedRoles(): Promise<void> {
    const roles = [
      {
        name: 'ADMIN',
        description: 'Administrateur',
      },
      {
        name: 'RESPONSABLE_VEILLE',
        description: 'Responsable veille / Qualité',
      },
      {
        name: 'REFERENT_LABORATOIRE',
        description: 'Référent laboratoire',
      },
      {
        name: 'LECTEUR',
        description: 'Lecteur',
      },
      {
        name: 'OPERATEUR_VEILLE',
        description: 'Stagiaire / opérateur de veille',
      },
    ];

    for (const roleData of roles) {
      let role = await this.roleRepository.findOne({
        where: {
          name: roleData.name,
        },
      });

      if (!role) {
        role = this.roleRepository.create(roleData);
        await this.roleRepository.save(role);
        this.logger.log(`Rôle initialisé : ${roleData.name}`);
      }
    }
  }

  async seedAdmin(): Promise<void> {
    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const rawPassword = process.env.SEED_ADMIN_PASSWORD;

    if (!email || !rawPassword) {
      this.logger.warn(
        'Seed Admin ignoré : SEED_ADMIN_EMAIL ou SEED_ADMIN_PASSWORD manquant dans .env',
      );
      return;
    }

    const existing = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    if (existing) {
      return;
    }

    const adminRole = await this.roleRepository.findOneBy({
      name: 'ADMIN',
    });

    if (!adminRole) {
      this.logger.error('Rôle ADMIN introuvable pour initialiser le compte.');
      return;
    }

    // Hachage sécurisé bcrypt (12 tours)
    const passwordHash = await bcrypt.hash(rawPassword, 12);

    const admin = this.userRepository.create({
      firstName: 'Administrateur',
      lastName: 'Plateforme',
      email,
      passwordHash,
      status: 'ACTIVE',
      mustChangePassword: true,
      roles: [adminRole],
    });

    const savedAdmin = await this.userRepository.save(admin);

    // Enregistrement dans l'historique des mots de passe
    await this.passwordHistoryRepository.save(
      this.passwordHistoryRepository.create({
        userId: savedAdmin.id,
        passwordHash,
      }),
    );

    this.logger.log(
      `Compte administrateur initialisé avec succès : ${email} (changement de mot de passe requis)`,
    );
  }
}
