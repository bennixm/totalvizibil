export async function fetchData<T>(url: string): Promise<T> {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`)
    }
    return response.json() as Promise<T>
}
