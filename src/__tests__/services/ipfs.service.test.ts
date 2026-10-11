// ipfs.service reads REACT_APP_IPFS_API_URL once, when the module loads, and falls back to the
// local proxy when it's unset. These tests are about that fallback, so the module is loaded with
// the variable cleared instead of with whatever an env file (e.g. .env.test.local) put there.
let uploadImageToIPFS: typeof import('../../services/ipfs.service').uploadImageToIPFS;
let uploadJSONToIPFS: typeof import('../../services/ipfs.service').uploadJSONToIPFS;

function jsonResponse(body: unknown, ok = true, statusText = 'Error') {
  return { ok, statusText, json: jest.fn().mockResolvedValue(body) };
}

describe('ipfs.service', () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.REACT_APP_IPFS_API_URL;

  beforeAll(() => {
    delete process.env.REACT_APP_IPFS_API_URL;
    jest.isolateModules(() => {
      ({ uploadImageToIPFS, uploadJSONToIPFS } = require('../../services/ipfs.service'));
    });
  });

  afterAll(() => {
    // Assigning undefined to a process.env key would store the string "undefined".
    if (originalApiUrl === undefined) delete process.env.REACT_APP_IPFS_API_URL;
    else process.env.REACT_APP_IPFS_API_URL = originalApiUrl;
  });

  afterEach(() => {
    global.fetch = originalFetch as typeof global.fetch;
  });

  it('uploadJSONToIPFS posts the metadata as JSON to the local proxy and returns the ipfs:// uri', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ uri: 'ipfs://bafyMetaCID' })) as any;

    const uri = await uploadJSONToIPFS({ name: 'Test Event' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/ipfs/upload-json',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Event' }),
      }),
    );
    expect(uri).toBe('ipfs://bafyMetaCID');
  });

  it('uploadImageToIPFS posts the file as multipart form-data and returns the ipfs:// uri', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ uri: 'ipfs://bafyImageCID' })) as any;
    const file = new File(['fake-bytes'], 'photo.png', { type: 'image/png' });

    const uri = await uploadImageToIPFS(file);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/ipfs/upload-image',
      expect.objectContaining({ method: 'POST' }),
    );
    const call = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(call.body).toBeInstanceOf(FormData);
    expect(uri).toBe('ipfs://bafyImageCID');
  });

  it('throws the server-provided error message on a non-OK response', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ error: 'Pinata upload failed (401): bad key' }, false)) as any;

    await expect(uploadJSONToIPFS({ name: 'x' })).rejects.toThrow('Pinata upload failed (401): bad key');
  });

  it('falls back to statusText when the error response has no body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: jest.fn().mockRejectedValue(new Error('no body')),
    }) as any;

    await expect(uploadJSONToIPFS({ name: 'x' })).rejects.toThrow('IPFS upload failed: Internal Server Error');
  });
});
