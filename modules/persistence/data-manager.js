const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

class DataManager {
  constructor(dataDirectory = './data') {
    this.dataDirectory = dataDirectory;
    this.ensureDataDirectory();
  }

  async ensureDataDirectory() {
    try {
      await fs.mkdir(this.dataDirectory, { recursive: true });
    } catch (error) {
      logger.error('DATA', `Failed to create data directory: ${error.message}`);
    }
  }

  async saveData(filename, data) {
    try {
      const filePath = path.join(this.dataDirectory, `${filename}.json`);
      const jsonData = JSON.stringify(data, this.mapReplacer, 2);
      await fs.writeFile(filePath, jsonData, 'utf8');
      logger.info('DATA', `Saved data to ${filename}.json`);
      return true;
    } catch (error) {
      logger.error('DATA', `Failed to save ${filename}: ${error.message}`);
      return false;
    }
  }

  async loadData(filename) {
    try {
      const filePath = path.join(this.dataDirectory, `${filename}.json`);
      const jsonData = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(jsonData, this.mapReviver);
      logger.info('DATA', `Loaded data from ${filename}.json`);
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('DATA', `No existing data file found for ${filename}, starting fresh`);
        return null;
      }
      logger.error('DATA', `Failed to load ${filename}: ${error.message}`);
      return null;
    }
  }

  async backupData(filename) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const originalPath = path.join(this.dataDirectory, `${filename}.json`);
      const backupPath = path.join(this.dataDirectory, 'backups', `${filename}_${timestamp}.json`);

      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.copyFile(originalPath, backupPath);
      logger.info('DATA', `Created backup: ${filename}_${timestamp}.json`);
      return true;
    } catch (error) {
      logger.error('DATA', `Failed to backup ${filename}: ${error.message}`);
      return false;
    }
  }

  async listBackups(filename) {
    try {
      const backupDir = path.join(this.dataDirectory, 'backups');
      const files = await fs.readdir(backupDir);
      const backups = files
        .filter(file => file.startsWith(filename) && file.endsWith('.json'))
        .sort()
        .reverse(); // Most recent first
      return backups;
    } catch (error) {
      logger.error('DATA', `Failed to list backups for ${filename}: ${error.message}`);
      return [];
    }
  }

  async restoreFromBackup(filename, backupFilename) {
    try {
      const backupPath = path.join(this.dataDirectory, 'backups', backupFilename);
      const currentPath = path.join(this.dataDirectory, `${filename}.json`);

      await fs.copyFile(backupPath, currentPath);
      logger.info('DATA', `Restored ${filename} from backup ${backupFilename}`);
      return true;
    } catch (error) {
      logger.error('DATA', `Failed to restore ${filename} from backup: ${error.message}`);
      return false;
    }
  }

  // Helper methods for Map serialization
  mapReplacer(key, value) {
    if (value instanceof Map) {
      return {
        dataType: 'Map',
        value: Array.from(value.entries())
      };
    }
    return value;
  }

  mapReviver(key, value) {
    if (typeof value === 'object' && value !== null) {
      if (value.dataType === 'Map') {
        return new Map(value.value);
      }
    }
    return value;
  }

  // Auto-save functionality
  startAutoSave(saveFunction, intervalMinutes = 5) {
    const intervalMs = intervalMinutes * 60 * 1000;
    const autoSaveInterval = setInterval(async () => {
      try {
        await saveFunction();
        logger.info('DATA', 'Auto-save completed');
      } catch (error) {
        logger.error('DATA', `Auto-save failed: ${error.message}`);
      }
    }, intervalMs);

    logger.info('DATA', `Auto-save started with ${intervalMinutes} minute intervals`);
    return autoSaveInterval;
  }

  stopAutoSave(intervalId) {
    if (intervalId) {
      clearInterval(intervalId);
      logger.info('DATA', 'Auto-save stopped');
    }
  }
}

module.exports = DataManager;
