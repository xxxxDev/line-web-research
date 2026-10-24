// Each server owns a separate cookie/session Map; each port is a browser origin.
function createInstanceManager({ createServer, saveCount = () => {}, saveState = () => {}, limit = 8, basePort = 0, initialNextId = 1 }) {
  const entries = [];
  let queue = Promise.resolve(), closing = false, nextId = initialNextId;
  const manager = {
    list: () => entries.map(({ id, url }) => ({ id, label: `LINE ${id}`, url })),
    create(restoredId) {
      const work = queue.then(async () => {
        if (closing) throw new Error('Service stopping');
        if (entries.length >= limit) throw new Error('Instance limit reached');
        const id = restoredId === undefined ? nextId : restoredId;
        if (!Number.isSafeInteger(id) || id < 1 || entries.some(e => e.id === String(id))) throw new Error('Invalid instance ID');
        const port = basePort ? basePort + id - 1 : 0;
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Fixed port range exhausted');
        const followingId = Math.max(nextId, id + 1);
        const server = createServer(manager);
        try {
          await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
          });
          const entry = { id: String(id), url: `http://127.0.0.1:${server.address().port}/index.html`, server };
          await saveCount(entries.length + 1);
          await saveState({ ids: [...entries.map(e => Number(e.id)), id], nextId: followingId });
          entries.push(entry);
          nextId = followingId;
          return { id: entry.id, label: `LINE ${entry.id}`, url: entry.url };
        } catch (error) {
          server.closeAllConnections();
          await new Promise(resolve => server.close(() => resolve()));
          throw error;
        }
      });
      queue = work.catch(() => {});
      return work;
    },
    remove(id, requesterOrigin) {
      const work = queue.then(async () => {
        if (closing) throw new Error('Service stopping');
        const index = entries.findIndex(entry => entry.id === id);
        if (index <= 0) throw new Error('Main instance cannot be deleted');
        const entry = entries[index];
        if (new URL(entry.url).origin === requesterOrigin) throw new Error('Cannot delete current portal');
        // Persist first: a disk failure must leave the running instance intact.
        await saveCount(entries.length - 1);
        await saveState({ ids: entries.filter(e => e !== entry).map(e => Number(e.id)), nextId });
        entry.server.closeAllConnections();
        await new Promise(resolve => entry.server.close(() => resolve()));
        entries.splice(index, 1);
      });
      queue = work.catch(() => {});
      return work;
    },
    async close() {
      closing = true;
      await queue;
      await Promise.all(entries.map(({server}) => new Promise(resolve => {
        server.closeAllConnections(); server.close(() => resolve());
      })));
      entries.length = 0;
    }
  };
  return manager;
}
module.exports = { createInstanceManager };
